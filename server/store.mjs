import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findNearDuplicateCanon } from './canon-similarity.mjs'

const defaultRooms = [
  ['fireside', 'fireside', 'The party table · everyone welcome'],
  ['in-character', 'in-character', 'Keep it in character'],
  ['planning', 'planning', 'Plans, theories, and questionable maps'],
  ['rules-desk', 'rules-desk', 'Rules questions and references'],
]

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createRecoveryCode() {
  return randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-')
}

function recoveryHash(code) {
  return tokenHash(code.toUpperCase().replace(/[^A-F0-9]/g, ''))
}

function matchesRecoveryCode(storedHash, code) {
  if (!storedHash || typeof code !== 'string' || code.toUpperCase().replace(/[^A-F0-9]/g, '').length !== 24) return false
  return timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(recoveryHash(code), 'hex'))
}

function roomSlug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room'
}

function publicCampaign(row, rooms) {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    rooms: rooms.map((room) => ({ id: room.id, slug: room.slug, name: room.name, description: room.description })),
  }
}

function publicCampaignWorld(row, collections = {}) {
  if (!row) return null
  const { truths = [], factions = [], locations = [], npcs = [], hooks = [], consequences = [] } = collections
  return {
    campaignId: row.campaign_id,
    title: row.title,
    premise: row.premise,
    pitch: row.pitch,
    openingCrisis: {
      title: row.opening_crisis_title,
      situation: row.opening_crisis_situation,
      stakes: row.opening_crisis_stakes,
    },
    truths: truths.map((item) => ({ id: item.id, text: item.text })),
    factions: factions.map((item) => ({ id: item.id, name: item.name, goal: item.goal, opposition: item.opposition })),
    locations: locations.map((item) => ({ id: item.id, name: item.name, description: item.description, danger: item.danger })),
    npcs: npcs.map((item) => ({ id: item.id, name: item.name, role: item.role, want: item.want, leverage: item.leverage })),
    hooks: hooks.map((item) => ({ id: item.id, title: item.title, situation: item.situation })),
    consequences: consequences.map(publicWorldConsequence),
    generatorVersion: row.generator_version,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name ?? null,
  }
}

function publicWorldConsequence(row) {
  return {
    id: row.id,
    sourceSceneId: row.source_scene_id,
    sourceSceneTitle: row.source_scene_title,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    beforeState: row.before_state,
    afterState: row.after_state,
    pressure: row.pressure,
    status: row.status,
    resolvedSceneId: row.resolved_scene_id ?? null,
    resolvedSceneTitle: row.resolved_scene_title ?? null,
    resolution: row.resolution ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

function publicPlayer(row, token) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    role: row.role,
    knowledgeRole: row.knowledge_role,
    ...(token ? { token } : {}),
  }
}

function publicMessage(row) {
  let scene = null
  if (row.kind !== 'chat' && row.metadata) {
    try { scene = JSON.parse(row.metadata) } catch { scene = null }
  }
  return {
    id: row.id,
    clientMessageId: row.client_message_id,
    senderId: row.player_id,
    senderName: row.sender_name,
    playerName: row.player_name ?? row.sender_name,
    characterName: row.character_name ?? null,
    text: row.text,
    sentAt: row.sent_at,
    sequence: row.sequence,
    kind: row.kind ?? 'chat',
    scene,
  }
}

function publicCharacter(row, { includeSecret = false } = {}) {
  if (!row) return null
  return {
    id: row.id,
    campaignId: row.campaign_id,
    playerId: row.player_id,
    playerName: row.player_name,
    name: row.name,
    concept: row.concept,
    appearance: row.appearance,
    drive: row.drive,
    capability: row.capability,
    complication: row.complication,
    possession: row.possession,
    belief: row.belief,
    secret: includeSecret ? row.secret : null,
    faction: row.faction_id ? { id: row.faction_id, name: row.faction_name, connection: row.faction_connection } : null,
    location: row.location_id ? { id: row.location_id, name: row.location_name, connection: row.location_connection } : null,
    npc: row.npc_id ? { id: row.npc_id, name: row.npc_name, connection: row.npc_connection } : null,
    character: row.connected_character_id ? { id: row.connected_character_id, name: row.connected_character_name, connection: row.character_connection } : null,
    generatorVersion: row.generator_version,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function publicScene(row, characters = []) {
  if (!row) return null
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    framing: row.framing,
    stakes: row.stakes,
    question: row.question,
    status: row.status,
    outcome: row.outcome ?? null,
    characters: characters.map((character) => ({ id: character.id, name: character.name, playerName: character.player_name })),
    createdByName: row.created_by_name ?? null,
    resolvedByName: row.resolved_by_name ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

function publicCharacterRevision(row) {
  return {
    id: row.id,
    revision: row.revision,
    reason: row.reason,
    changedFields: JSON.parse(row.changed_fields),
    snapshot: JSON.parse(row.snapshot),
    scene: row.scene_id ? { id: row.scene_id, title: row.scene_title } : null,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  }
}

function publicCanonProposal(row, sources = []) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    claim: row.claim,
    visibility: row.visibility,
    confidence: row.confidence,
    status: row.status,
    extractorVersion: row.extractor_version,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    sources: sources.map((source) => ({
      messageId: source.message_id,
      roomId: source.room_id,
      roomName: source.room_name,
      senderName: source.sender_name,
      text: source.text,
      excerpt: source.excerpt,
      sentAt: source.sent_at,
      sequence: source.sequence,
    })),
  }
}

function publicCanonEntry(row, sources = [], audiences = [], evidenceBasis = 'full') {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    claim: row.claim,
    visibility: audiences.length ? 'characters' : row.visibility,
    audiencePlayerIds: audiences.map((audience) => audience.id),
    audienceNames: audiences.map((audience) => audience.name),
    evidenceBasis,
    revision: row.revision,
    status: row.status === 'active' ? 'active' : row.retired_reason ?? 'superseded',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name ?? null,
    latestReason: row.latest_reason ?? null,
    sources: sources.map((source) => ({
      messageId: source.message_id,
      roomId: source.room_id,
      roomName: source.room_name,
      senderName: source.sender_name,
      text: source.text,
      excerpt: source.excerpt,
      sentAt: source.sent_at,
      sequence: source.sequence,
    })),
  }
}

function publicCanonRevision(row, audiences = []) {
  return {
    id: row.id,
    entryId: row.entry_id,
    revision: row.revision,
    action: row.action,
    title: row.title,
    claim: row.claim,
    visibility: audiences.length ? 'characters' : row.visibility,
    audiencePlayerIds: audiences.map((audience) => audience.id),
    audienceNames: audiences.map((audience) => audience.name),
    reason: row.reason,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  }
}

function publicCanonConstitution(row) {
  return {
    canonThreshold: row.canon_threshold,
    playerDeclarations: row.player_declarations,
    oocPolicy: row.ooc_policy,
    correctionPolicy: row.correction_policy,
    defaultVisibility: row.default_visibility,
    guidance: row.guidance,
    revision: row.revision,
    updatedAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
  }
}

function publicContinuityBrief(row, threads = []) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    generatorVersion: row.generator_version,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    contextSession: row.session_start_sequence == null ? null : {
      id: row.session_id,
      title: row.session_title,
      status: row.session_status,
      startSequence: row.session_start_sequence,
      endSequence: row.session_end_sequence,
    },
    threads,
  }
}

function publicContradictionReport(row, findings = []) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    generatorVersion: row.generator_version,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    contextSession: row.session_start_sequence == null ? null : {
      id: row.session_id,
      title: row.session_title,
      status: row.session_status,
      startSequence: row.session_start_sequence,
      endSequence: row.session_end_sequence,
    },
    findings,
  }
}

function publicSessionRecap(row, sources = [], { includeGmNotes = false } = {}) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    generatorVersion: row.generator_version,
    status: row.status,
    revision: row.revision,
    publicSummary: row.public_summary,
    gmNotes: includeGmNotes ? row.gm_notes : null,
    contextSession: {
      id: row.session_id, title: row.session_title, status: row.session_status,
      startSequence: row.session_start_sequence, endSequence: row.session_end_sequence,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    updatedByName: row.updated_by_name ?? null,
    publishedAt: row.published_at,
    sources,
  }
}

function publicPreparationRun(row, tasks = []) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    requestedByPlayerId: row.requested_by_player_id,
    status: row.status,
    tasks: tasks.map((task) => ({
      name: task.task,
      status: task.status,
      attempts: task.attempts,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      startedAt: task.started_at,
      completedAt: task.completed_at,
    })),
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export function createStore(databasePath) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
      knowledge_role TEXT NOT NULL DEFAULT 'player' CHECK(knowledge_role IN ('gm', 'player')),
      token_hash TEXT NOT NULL UNIQUE,
      recovery_key_hash TEXT,
      removed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      UNIQUE(campaign_id, slug)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      client_message_id TEXT,
      text TEXT NOT NULL,
      character_name TEXT,
      kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat', 'scene_start', 'scene_end')),
      metadata TEXT,
      sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_notes (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      updated_by_player_id TEXT REFERENCES players(id),
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS campaign_worlds (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      premise TEXT NOT NULL,
      pitch TEXT NOT NULL,
      opening_crisis_title TEXT NOT NULL,
      opening_crisis_situation TEXT NOT NULL,
      opening_crisis_stakes TEXT NOT NULL,
      generator_version TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      updated_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_world_truths (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign_worlds(campaign_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS campaign_world_factions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign_worlds(campaign_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      opposition TEXT NOT NULL,
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS campaign_world_locations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign_worlds(campaign_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      danger TEXT NOT NULL,
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS campaign_world_npcs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign_worlds(campaign_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      want TEXT NOT NULL,
      leverage TEXT NOT NULL,
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS campaign_world_hooks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign_worlds(campaign_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      situation TEXT NOT NULL,
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      concept TEXT NOT NULL,
      appearance TEXT NOT NULL,
      drive TEXT NOT NULL,
      capability TEXT NOT NULL,
      complication TEXT NOT NULL,
      possession TEXT NOT NULL,
      belief TEXT NOT NULL,
      secret TEXT NOT NULL,
      faction_id TEXT REFERENCES campaign_world_factions(id) ON DELETE SET NULL,
      faction_connection TEXT,
      location_id TEXT REFERENCES campaign_world_locations(id) ON DELETE SET NULL,
      location_connection TEXT,
      npc_id TEXT REFERENCES campaign_world_npcs(id) ON DELETE SET NULL,
      npc_connection TEXT,
      connected_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      character_connection TEXT,
      generator_version TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_scenes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      framing TEXT NOT NULL,
      stakes TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
      outcome TEXT,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      resolved_by_player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS campaign_scene_characters (
      scene_id TEXT NOT NULL REFERENCES campaign_scenes(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
      PRIMARY KEY (scene_id, character_id)
    );
    CREATE TABLE IF NOT EXISTS world_consequences (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      source_scene_id TEXT NOT NULL REFERENCES campaign_scenes(id) ON DELETE RESTRICT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('faction', 'location', 'npc', 'hook')),
      entity_id TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      pressure TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
      resolved_scene_id TEXT REFERENCES campaign_scenes(id) ON DELETE RESTRICT,
      resolution TEXT,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      resolved_by_player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS world_consequences_campaign_status ON world_consequences(campaign_id, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS character_revisions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      scene_id TEXT REFERENCES campaign_scenes(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      changed_fields TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      UNIQUE(character_id, revision)
    );
    CREATE TABLE IF NOT EXISTS campaign_sessions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_sequence INTEGER NOT NULL,
      end_sequence INTEGER NOT NULL,
      closed_by_player_id TEXT NOT NULL REFERENCES players(id),
      closed_at TEXT NOT NULL,
      CHECK(start_sequence <= end_sequence)
    );
    CREATE TABLE IF NOT EXISTS room_reads (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      last_read_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (player_id, room_id)
    );
    CREATE TABLE IF NOT EXISTS canon_proposals (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('fact', 'character', 'relationship', 'promise', 'event', 'question', 'contradiction', 'rule')),
      title TEXT NOT NULL,
      claim TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK(visibility IN ('campaign', 'gm_only')),
      confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'disputed', 'rejected')),
      extractor_version TEXT NOT NULL,
      extraction_key TEXT,
      created_by_player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canon_proposal_sources (
      proposal_id TEXT NOT NULL REFERENCES canon_proposals(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (proposal_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS canon_entries (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES canon_proposals(id) ON DELETE RESTRICT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      claim TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK(visibility IN ('campaign', 'gm_only')),
      revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded')),
      retired_reason TEXT CHECK(retired_reason IS NULL OR retired_reason IN ('superseded', 'retracted')),
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canon_decisions (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES canon_proposals(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id),
      action TEXT NOT NULL CHECK(action IN ('accept', 'edit_accept', 'dispute', 'reject')),
      reason TEXT,
      accepted_title TEXT,
      accepted_claim TEXT,
      accepted_visibility TEXT CHECK(accepted_visibility IS NULL OR accepted_visibility IN ('campaign', 'gm_only')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canon_entry_revisions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('accepted', 'revised', 'superseded', 'retracted')),
      title TEXT NOT NULL,
      claim TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK(visibility IN ('campaign', 'gm_only')),
      reason TEXT,
      player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      UNIQUE(entry_id, revision)
    );
    CREATE TABLE IF NOT EXISTS canon_entry_audiences (
      entry_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS canon_revision_audiences (
      revision_id TEXT NOT NULL REFERENCES canon_entry_revisions(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (revision_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS canon_scan_state (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      last_scanned_sequence INTEGER NOT NULL DEFAULT 0,
      updated_by_player_id TEXT NOT NULL REFERENCES players(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canon_constitution_revisions (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      canon_threshold TEXT NOT NULL CHECK(canon_threshold IN ('explicit_only', 'table_consensus', 'played_as_true')),
      player_declarations TEXT NOT NULL CHECK(player_declarations IN ('require_confirmation', 'stand_unless_challenged')),
      ooc_policy TEXT NOT NULL CHECK(ooc_policy IN ('exclude', 'explicit_corrections_only')),
      correction_policy TEXT NOT NULL CHECK(correction_policy IN ('latest_explicit', 'flag_conflicts')),
      default_visibility TEXT NOT NULL CHECK(default_visibility IN ('campaign', 'gm_only')),
      guidance TEXT NOT NULL DEFAULT '',
      player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, revision)
    );
    CREATE TABLE IF NOT EXISTS canon_proposal_matches (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      matched_proposal_id TEXT NOT NULL REFERENCES canon_proposals(id) ON DELETE CASCADE,
      extractor_version TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('existing', 'merged', 'suppressed')),
      matched_status TEXT NOT NULL CHECK(matched_status IN ('proposed', 'accepted', 'disputed', 'rejected')),
      similarity REAL NOT NULL CHECK(similarity >= 0 AND similarity <= 1),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contradiction_reports (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      generator_version TEXT NOT NULL,
      session_id TEXT,
      session_title TEXT,
      session_status TEXT CHECK(session_status IS NULL OR session_status IN ('open', 'closed')),
      session_start_sequence INTEGER,
      session_end_sequence INTEGER,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contradiction_findings (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES contradiction_reports(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      canon_entry_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE RESTRICT,
      canon_title TEXT NOT NULL,
      canon_claim TEXT NOT NULL,
      title TEXT NOT NULL,
      explanation TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1)
    );
    CREATE TABLE IF NOT EXISTS contradiction_sources (
      finding_id TEXT NOT NULL REFERENCES contradiction_findings(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (finding_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS continuity_briefs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      preparation_run_id TEXT,
      generator_version TEXT NOT NULL,
      session_id TEXT,
      session_title TEXT,
      session_status TEXT CHECK(session_status IS NULL OR session_status IN ('open', 'closed')),
      session_start_sequence INTEGER,
      session_end_sequence INTEGER,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuity_threads (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES continuity_briefs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1)
    );
    CREATE TABLE IF NOT EXISTS continuity_thread_sources (
      thread_id TEXT NOT NULL REFERENCES continuity_threads(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (thread_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS continuity_feedback (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES continuity_threads(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id),
      rating TEXT NOT NULL CHECK(rating IN ('useful', 'incorrect', 'secret_leak', 'not_useful')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuity_thread_transitions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES continuity_threads(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('open', 'dormant', 'resolved')),
      reason TEXT NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_recaps (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      preparation_run_id TEXT,
      generator_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
      revision INTEGER NOT NULL DEFAULT 0,
      public_summary TEXT NOT NULL,
      gm_notes TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_title TEXT NOT NULL,
      session_status TEXT NOT NULL CHECK(session_status IN ('open', 'closed')),
      session_start_sequence INTEGER NOT NULL,
      session_end_sequence INTEGER NOT NULL,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      updated_by_player_id TEXT REFERENCES players(id),
      updated_at TEXT,
      published_by_player_id TEXT REFERENCES players(id),
      published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS session_recap_sources (
      recap_id TEXT NOT NULL REFERENCES session_recaps(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (recap_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS session_recap_revisions (
      id TEXT PRIMARY KEY,
      recap_id TEXT NOT NULL REFERENCES session_recaps(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      public_summary TEXT NOT NULL,
      gm_notes TEXT NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      UNIQUE(recap_id, revision)
    );
    CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      suite TEXT NOT NULL,
      model TEXT NOT NULL,
      generator_version TEXT NOT NULL,
      passed INTEGER NOT NULL CHECK(passed >= 0),
      total INTEGER NOT NULL CHECK(total > 0 AND passed <= total),
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_inference_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      surface TEXT NOT NULL,
      generator_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed')),
      duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
      input_units INTEGER CHECK(input_units IS NULL OR input_units >= 0),
      output_units INTEGER CHECK(output_units IS NULL OR output_units >= 0),
      error_category TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_inference_runs_campaign_created ON ai_inference_runs(campaign_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS campaign_intelligence_settings (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      auto_prepare INTEGER NOT NULL DEFAULT 0 CHECK(auto_prepare IN (0, 1)),
      prepare_canon INTEGER NOT NULL DEFAULT 1 CHECK(prepare_canon IN (0, 1)),
      prepare_continuity INTEGER NOT NULL DEFAULT 1 CHECK(prepare_continuity IN (0, 1)),
      prepare_recap INTEGER NOT NULL DEFAULT 1 CHECK(prepare_recap IN (0, 1)),
      updated_by_player_id TEXT REFERENCES players(id),
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS preparation_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'complete', 'failed')),
      tasks TEXT NOT NULL,
      result TEXT,
      error TEXT,
      requested_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(campaign_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS preparation_run_tasks (
      run_id TEXT NOT NULL REFERENCES preparation_runs(id) ON DELETE CASCADE,
      task TEXT NOT NULL CHECK(task IN ('canon', 'continuity', 'recap')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'complete', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      PRIMARY KEY (run_id, task)
    );
    CREATE TABLE IF NOT EXISTS knowledge_answers (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      subject_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      requested_by_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      generator_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_answer_sources (
      answer_id TEXT NOT NULL REFERENCES knowledge_answers(id) ON DELETE CASCADE,
      canon_entry_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE RESTRICT,
      PRIMARY KEY (answer_id, canon_entry_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_answer_feedback (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL REFERENCES knowledge_answers(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      rating TEXT NOT NULL CHECK(rating IN ('useful', 'incorrect', 'incomplete', 'secret_leak')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS house_rules (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_rule TEXT NOT NULL,
      interpretation TEXT NOT NULL,
      ruling TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
      revision INTEGER NOT NULL DEFAULT 0,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS house_rule_proposals (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE RESTRICT,
      generator_version TEXT NOT NULL,
      title TEXT NOT NULL,
      source_rule TEXT NOT NULL,
      interpretation TEXT NOT NULL,
      ruling TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'rejected')),
      decision_action TEXT CHECK(decision_action IS NULL OR decision_action IN ('accept', 'edit_accept', 'reject')),
      decision_reason TEXT,
      decided_title TEXT,
      decided_source_rule TEXT,
      decided_interpretation TEXT,
      decided_ruling TEXT,
      accepted_rule_id TEXT REFERENCES house_rules(id) ON DELETE SET NULL,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      decided_by_player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS house_rule_proposal_sources (
      proposal_id TEXT NOT NULL REFERENCES house_rule_proposals(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (proposal_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS house_rule_revisions (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES house_rules(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_rule TEXT NOT NULL,
      interpretation TEXT NOT NULL,
      ruling TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
      reason TEXT NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      UNIQUE(rule_id, revision)
    );
    CREATE TABLE IF NOT EXISTS house_rule_revision_sources (
      revision_id TEXT NOT NULL REFERENCES house_rule_revisions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (revision_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS faction_clocks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      segments INTEGER NOT NULL DEFAULT 6 CHECK(segments BETWEEN 2 AND 12),
      revision INTEGER NOT NULL DEFAULT 0,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS faction_clock_proposals (
      id TEXT PRIMARY KEY,
      clock_id TEXT NOT NULL REFERENCES faction_clocks(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      assumptions TEXT NOT NULL,
      base_progress INTEGER NOT NULL,
      proposed_progress INTEGER NOT NULL,
      session_id TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'rejected')),
      generator_version TEXT NOT NULL,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      decided_by_player_id TEXT REFERENCES players(id),
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS faction_clock_proposal_sources (
      proposal_id TEXT NOT NULL REFERENCES faction_clock_proposals(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      excerpt TEXT,
      PRIMARY KEY (proposal_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS spotlight_consents (
      player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
      start_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spotlight_consent_events (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      effective_sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spotlight_reports (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE RESTRICT,
      session_title TEXT NOT NULL,
      session_start_sequence INTEGER NOT NULL,
      session_end_sequence INTEGER NOT NULL,
      total_messages INTEGER NOT NULL,
      created_by_player_id TEXT NOT NULL REFERENCES players(id),
      created_at TEXT NOT NULL,
      UNIQUE(campaign_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS spotlight_report_participants (
      report_id TEXT NOT NULL REFERENCES spotlight_reports(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
      message_count INTEGER NOT NULL,
      share REAL NOT NULL,
      PRIMARY KEY (report_id, player_id)
    );
  `)

  const playerColumns = database.prepare('PRAGMA table_info(players)').all()
  if (!playerColumns.some((column) => column.name === 'role')) {
    database.exec("ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member'))")
    database.exec("UPDATE players SET role = 'owner' WHERE rowid IN (SELECT MIN(rowid) FROM players GROUP BY campaign_id)")
  }
  if (!playerColumns.some((column) => column.name === 'removed_at')) database.exec('ALTER TABLE players ADD COLUMN removed_at TEXT')
  if (!playerColumns.some((column) => column.name === 'recovery_key_hash')) database.exec('ALTER TABLE players ADD COLUMN recovery_key_hash TEXT')
  if (!playerColumns.some((column) => column.name === 'knowledge_role')) {
    database.exec("ALTER TABLE players ADD COLUMN knowledge_role TEXT NOT NULL DEFAULT 'player' CHECK(knowledge_role IN ('gm', 'player'))")
    database.exec("UPDATE players SET knowledge_role = 'gm' WHERE role = 'owner'")
  }
  const messageColumns = database.prepare('PRAGMA table_info(messages)').all()
  if (!messageColumns.some((column) => column.name === 'character_name')) database.exec('ALTER TABLE messages ADD COLUMN character_name TEXT')
  if (!messageColumns.some((column) => column.name === 'kind')) database.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat', 'scene_start', 'scene_end'))")
  if (!messageColumns.some((column) => column.name === 'metadata')) database.exec('ALTER TABLE messages ADD COLUMN metadata TEXT')
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS campaign_scenes_one_active ON campaign_scenes(campaign_id) WHERE status = 'active'")
  const roomColumns = database.prepare('PRAGMA table_info(rooms)').all()
  if (!roomColumns.some((column) => column.name === 'position')) {
    database.exec('ALTER TABLE rooms ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
    database.exec(`
      UPDATE rooms AS target
      SET position = (
        SELECT COUNT(*) - 1 FROM rooms AS preceding
        WHERE preceding.campaign_id = target.campaign_id AND preceding.rowid <= target.rowid
      )
    `)
  }
  if (!roomColumns.some((column) => column.name === 'archived_at')) database.exec('ALTER TABLE rooms ADD COLUMN archived_at TEXT')
  const canonProposalColumns = database.prepare('PRAGMA table_info(canon_proposals)').all()
  if (!canonProposalColumns.some((column) => column.name === 'extraction_key')) database.exec('ALTER TABLE canon_proposals ADD COLUMN extraction_key TEXT')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS canon_proposals_extraction_key ON canon_proposals(campaign_id, extraction_key) WHERE extraction_key IS NOT NULL')
  const canonDecisionColumns = database.prepare('PRAGMA table_info(canon_decisions)').all()
  if (!canonDecisionColumns.some((column) => column.name === 'accepted_visibility')) database.exec("ALTER TABLE canon_decisions ADD COLUMN accepted_visibility TEXT CHECK(accepted_visibility IS NULL OR accepted_visibility IN ('campaign', 'gm_only'))")
  const canonEntryColumns = database.prepare('PRAGMA table_info(canon_entries)').all()
  if (!canonEntryColumns.some((column) => column.name === 'retired_reason')) database.exec("ALTER TABLE canon_entries ADD COLUMN retired_reason TEXT CHECK(retired_reason IS NULL OR retired_reason IN ('superseded', 'retracted'))")
  const spotlightConsentColumns = database.prepare('PRAGMA table_info(spotlight_consents)').all()
  if (!spotlightConsentColumns.some((column) => column.name === 'start_sequence')) database.exec('ALTER TABLE spotlight_consents ADD COLUMN start_sequence INTEGER NOT NULL DEFAULT 0')
  for (const table of ['continuity_briefs', 'contradiction_reports']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
    if (!columns.some((column) => column.name === 'session_id')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_id TEXT`)
    if (!columns.some((column) => column.name === 'session_title')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_title TEXT`)
    if (!columns.some((column) => column.name === 'session_status')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_status TEXT CHECK(session_status IS NULL OR session_status IN ('open', 'closed'))`)
    if (!columns.some((column) => column.name === 'session_start_sequence')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_start_sequence INTEGER`)
    if (!columns.some((column) => column.name === 'session_end_sequence')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_end_sequence INTEGER`)
  }
  const recapColumns = database.prepare('PRAGMA table_info(session_recaps)').all()
  if (!recapColumns.some((column) => column.name === 'revision')) database.exec('ALTER TABLE session_recaps ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
  if (!recapColumns.some((column) => column.name === 'updated_by_player_id')) database.exec('ALTER TABLE session_recaps ADD COLUMN updated_by_player_id TEXT REFERENCES players(id)')
  if (!recapColumns.some((column) => column.name === 'updated_at')) database.exec('ALTER TABLE session_recaps ADD COLUMN updated_at TEXT')
  if (!recapColumns.some((column) => column.name === 'preparation_run_id')) database.exec('ALTER TABLE session_recaps ADD COLUMN preparation_run_id TEXT')
  const continuityColumns = database.prepare('PRAGMA table_info(continuity_briefs)').all()
  if (!continuityColumns.some((column) => column.name === 'preparation_run_id')) database.exec('ALTER TABLE continuity_briefs ADD COLUMN preparation_run_id TEXT')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS continuity_briefs_preparation_run ON continuity_briefs(preparation_run_id) WHERE preparation_run_id IS NOT NULL')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS session_recaps_preparation_run ON session_recaps(preparation_run_id) WHERE preparation_run_id IS NOT NULL')
  const factionProposalColumns = database.prepare('PRAGMA table_info(faction_clock_proposals)').all()
  if (!factionProposalColumns.some((column) => column.name === 'base_progress')) database.exec('ALTER TABLE faction_clock_proposals ADD COLUMN base_progress INTEGER NOT NULL DEFAULT 0')
  if (!factionProposalColumns.some((column) => column.name === 'session_id')) database.exec("ALTER TABLE faction_clock_proposals ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
  database.exec(`
    INSERT OR IGNORE INTO session_recap_revisions (id, recap_id, revision, public_summary, gm_notes, player_id, created_at)
    SELECT lower(hex(randomblob(16))), id, revision, public_summary, gm_notes, created_by_player_id, created_at FROM session_recaps
  `)
  database.exec(`
    INSERT OR IGNORE INTO canon_entry_revisions (
      id, entry_id, revision, action, title, claim, visibility, reason, player_id, created_at
    )
    SELECT lower(hex(randomblob(16))), canon_entries.id, canon_entries.revision, 'accepted',
           canon_entries.title, canon_entries.claim, canon_entries.visibility, 'Imported from the existing canon ledger.',
           canon_entries.created_by_player_id, canon_entries.created_at
    FROM canon_entries
    WHERE NOT EXISTS (
      SELECT 1 FROM canon_entry_revisions WHERE canon_entry_revisions.entry_id = canon_entries.id
    )
  `)
  database.exec("INSERT OR IGNORE INTO campaign_notes (campaign_id) SELECT id FROM campaigns")
  database.exec("INSERT OR IGNORE INTO campaign_intelligence_settings (campaign_id) SELECT id FROM campaigns")
  database.exec(`
    INSERT OR IGNORE INTO canon_constitution_revisions (
      campaign_id, revision, canon_threshold, player_declarations, ooc_policy,
      correction_policy, default_visibility, guidance, player_id, created_at
    ) SELECT id, 0, 'explicit_only', 'require_confirmation', 'exclude',
             'latest_explicit', 'gm_only', '', NULL, created_at
      FROM campaigns
  `)
  database.exec(`
    DELETE FROM messages
    WHERE client_message_id IS NOT NULL
      AND rowid NOT IN (
        SELECT MIN(rowid) FROM messages WHERE client_message_id IS NOT NULL GROUP BY player_id, client_message_id
      );
    CREATE UNIQUE INDEX IF NOT EXISTS messages_player_client_id
      ON messages(player_id, client_message_id) WHERE client_message_id IS NOT NULL;
  `)
  const initializePlayerReads = database.prepare(`
    INSERT OR IGNORE INTO room_reads (player_id, room_id, last_read_sequence, updated_at)
    SELECT players.id, rooms.id, COALESCE(MAX(messages.rowid), 0), ?
    FROM players
    JOIN rooms ON rooms.campaign_id = players.campaign_id
    LEFT JOIN messages ON messages.room_id = rooms.id
    GROUP BY players.id, rooms.id
  `)
  initializePlayerReads.run(new Date().toISOString())

  const campaignByInvite = database.prepare('SELECT * FROM campaigns WHERE invite_code = ?')
  const campaignById = database.prepare('SELECT * FROM campaigns WHERE id = ?')
  const roomsByCampaign = database.prepare('SELECT * FROM rooms WHERE campaign_id = ? AND archived_at IS NULL ORDER BY position, rowid')
  const insertCampaign = database.prepare('INSERT INTO campaigns (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)')
  const updateInvitation = database.prepare('UPDATE campaigns SET invite_code = ? WHERE id = ?')
  const insertRoom = database.prepare('INSERT INTO rooms (id, campaign_id, slug, name, description, position) VALUES (?, ?, ?, ?, ?, ?)')
  const insertPlayer = database.prepare('INSERT INTO players (id, campaign_id, name, role, knowledge_role, token_hash, recovery_key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const playersByCampaign = database.prepare('SELECT * FROM players WHERE campaign_id = ? AND removed_at IS NULL ORDER BY rowid')
  const activePlayerByName = database.prepare('SELECT * FROM players WHERE campaign_id = ? AND name = ? COLLATE NOCASE AND removed_at IS NULL')
  const playerForCampaign = database.prepare('SELECT * FROM players WHERE id = ? AND campaign_id = ? AND removed_at IS NULL')
  const removePlayer = database.prepare('UPDATE players SET removed_at = ? WHERE id = ?')
  const updatePlayerCredentials = database.prepare('UPDATE players SET token_hash = ?, recovery_key_hash = ? WHERE id = ?')
  const updateRecoveryKey = database.prepare('UPDATE players SET recovery_key_hash = ? WHERE id = ?')
  const updateKnowledgeRole = database.prepare("UPDATE players SET knowledge_role = ? WHERE id = ? AND campaign_id = ? AND role != 'owner' AND removed_at IS NULL")
  const playerByToken = database.prepare(`
    SELECT players.*, campaigns.name AS campaign_name, campaigns.invite_code
    FROM players JOIN campaigns ON campaigns.id = players.campaign_id
    WHERE players.token_hash = ? AND players.removed_at IS NULL
  `)
  const roomForCampaign = database.prepare('SELECT * FROM rooms WHERE id = ? AND campaign_id = ? AND archived_at IS NULL')
  const updateRoom = database.prepare('UPDATE rooms SET name = ?, description = ? WHERE id = ? AND campaign_id = ?')
  const roomSlugExists = database.prepare('SELECT 1 FROM rooms WHERE campaign_id = ? AND slug = ?')
  const nextRoomPosition = database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM rooms WHERE campaign_id = ?')
  const updateRoomPosition = database.prepare('UPDATE rooms SET position = ? WHERE id = ? AND campaign_id = ?')
  const archiveRoom = database.prepare('UPDATE rooms SET archived_at = ? WHERE id = ? AND campaign_id = ?')
  const insertMessage = database.prepare(`
    INSERT OR IGNORE INTO messages (id, room_id, player_id, client_message_id, text, character_name, kind, metadata, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const messageByClientId = database.prepare(`
    SELECT messages.id, messages.client_message_id, messages.player_id,
           COALESCE(messages.character_name, players.name) AS sender_name,
           players.name AS player_name, messages.character_name, messages.kind, messages.metadata,
           messages.text, messages.sent_at, messages.rowid AS sequence
    FROM messages JOIN players ON players.id = messages.player_id
    WHERE messages.player_id = ? AND messages.client_message_id = ?
  `)
  const insertCampaignNote = database.prepare('INSERT INTO campaign_notes (campaign_id) VALUES (?)')
  const insertDefaultCanonConstitution = database.prepare(`
    INSERT INTO canon_constitution_revisions (
      campaign_id, revision, canon_threshold, player_declarations, ooc_policy,
      correction_policy, default_visibility, guidance, player_id, created_at
    ) VALUES (?, 0, 'explicit_only', 'require_confirmation', 'exclude', 'latest_explicit', 'gm_only', '', ?, ?)
  `)
  const campaignNote = database.prepare(`
    SELECT campaign_notes.*, players.name AS updated_by_name
    FROM campaign_notes LEFT JOIN players ON players.id = campaign_notes.updated_by_player_id
    WHERE campaign_notes.campaign_id = ?
  `)
  const updateCampaignNote = database.prepare(`
    UPDATE campaign_notes SET body = ?, revision = ?, updated_by_player_id = ?, updated_at = ?
    WHERE campaign_id = ?
  `)
  const campaignWorld = database.prepare(`
    SELECT campaign_worlds.*, players.name AS updated_by_name
    FROM campaign_worlds
    LEFT JOIN players ON players.id = campaign_worlds.updated_by_player_id
    WHERE campaign_worlds.campaign_id = ?
  `)
  const campaignWorldTruths = database.prepare('SELECT * FROM campaign_world_truths WHERE campaign_id = ? ORDER BY position')
  const campaignWorldFactions = database.prepare('SELECT * FROM campaign_world_factions WHERE campaign_id = ? ORDER BY position')
  const campaignWorldLocations = database.prepare('SELECT * FROM campaign_world_locations WHERE campaign_id = ? ORDER BY position')
  const campaignWorldNpcs = database.prepare('SELECT * FROM campaign_world_npcs WHERE campaign_id = ? ORDER BY position')
  const campaignWorldHooks = database.prepare('SELECT * FROM campaign_world_hooks WHERE campaign_id = ? ORDER BY position')
  const insertCampaignWorld = database.prepare(`
    INSERT INTO campaign_worlds (
      campaign_id, title, premise, pitch, opening_crisis_title, opening_crisis_situation,
      opening_crisis_stakes, generator_version, revision, created_by_player_id,
      updated_by_player_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `)
  const updateCampaignWorld = database.prepare(`
    UPDATE campaign_worlds SET
      title = ?, premise = ?, pitch = ?, opening_crisis_title = ?, opening_crisis_situation = ?,
      opening_crisis_stakes = ?, revision = revision + 1, updated_by_player_id = ?, updated_at = ?
    WHERE campaign_id = ? AND revision = ?
  `)
  const clearCampaignWorldTruths = database.prepare('DELETE FROM campaign_world_truths WHERE campaign_id = ?')
  const clearCampaignWorldFactions = database.prepare('DELETE FROM campaign_world_factions WHERE campaign_id = ?')
  const clearCampaignWorldLocations = database.prepare('DELETE FROM campaign_world_locations WHERE campaign_id = ?')
  const clearCampaignWorldNpcs = database.prepare('DELETE FROM campaign_world_npcs WHERE campaign_id = ?')
  const clearCampaignWorldHooks = database.prepare('DELETE FROM campaign_world_hooks WHERE campaign_id = ?')
  const insertCampaignWorldTruth = database.prepare('INSERT INTO campaign_world_truths (id, campaign_id, position, text) VALUES (?, ?, ?, ?)')
  const insertCampaignWorldFaction = database.prepare('INSERT INTO campaign_world_factions (id, campaign_id, position, name, goal, opposition) VALUES (?, ?, ?, ?, ?, ?)')
  const insertCampaignWorldLocation = database.prepare('INSERT INTO campaign_world_locations (id, campaign_id, position, name, description, danger) VALUES (?, ?, ?, ?, ?, ?)')
  const insertCampaignWorldNpc = database.prepare('INSERT INTO campaign_world_npcs (id, campaign_id, position, name, role, want, leverage) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertCampaignWorldHook = database.prepare('INSERT INTO campaign_world_hooks (id, campaign_id, position, title, situation) VALUES (?, ?, ?, ?, ?)')
  const worldConsequences = database.prepare(`
    SELECT world_consequences.*, source.title AS source_scene_title, resolved.title AS resolved_scene_title,
      creators.name AS created_by_name
    FROM world_consequences
    JOIN campaign_scenes AS source ON source.id = world_consequences.source_scene_id
    LEFT JOIN campaign_scenes AS resolved ON resolved.id = world_consequences.resolved_scene_id
    LEFT JOIN players AS creators ON creators.id = world_consequences.created_by_player_id
    WHERE world_consequences.campaign_id = ?
    ORDER BY world_consequences.created_at DESC, world_consequences.rowid DESC
  `)
  const activeWorldConsequences = database.prepare(`
    SELECT world_consequences.*, source.title AS source_scene_title, NULL AS resolved_scene_title,
      creators.name AS created_by_name
    FROM world_consequences
    JOIN campaign_scenes AS source ON source.id = world_consequences.source_scene_id
    LEFT JOIN players AS creators ON creators.id = world_consequences.created_by_player_id
    WHERE world_consequences.campaign_id = ? AND world_consequences.status = 'active'
    ORDER BY world_consequences.created_at DESC, world_consequences.rowid DESC
  `)
  const activeWorldConsequenceForEntity = database.prepare("SELECT * FROM world_consequences WHERE campaign_id = ? AND entity_type = ? AND entity_id = ? AND status = 'active' ORDER BY rowid DESC LIMIT 1")
  const resolveWorldConsequence = database.prepare("UPDATE world_consequences SET status = 'resolved', resolved_scene_id = ?, resolution = ?, resolved_by_player_id = ?, resolved_at = ? WHERE id = ? AND status = 'active'")
  const insertWorldConsequence = database.prepare('INSERT INTO world_consequences (id, campaign_id, source_scene_id, entity_type, entity_id, entity_name, before_state, after_state, pressure, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const characterSelect = `
    SELECT characters.*, players.name AS player_name,
           factions.name AS faction_name, locations.name AS location_name, npcs.name AS npc_name,
           connected.name AS connected_character_name
    FROM characters
    JOIN players ON players.id = characters.player_id
    LEFT JOIN campaign_world_factions AS factions ON factions.id = characters.faction_id
    LEFT JOIN campaign_world_locations AS locations ON locations.id = characters.location_id
    LEFT JOIN campaign_world_npcs AS npcs ON npcs.id = characters.npc_id
    LEFT JOIN characters AS connected ON connected.id = characters.connected_character_id
  `
  const charactersByCampaign = database.prepare(`${characterSelect} WHERE characters.campaign_id = ? ORDER BY characters.rowid`)
  const allCharacters = database.prepare(`${characterSelect} ORDER BY characters.rowid`)
  const characterByPlayer = database.prepare(`${characterSelect} WHERE characters.player_id = ? AND characters.campaign_id = ?`)
  const characterById = database.prepare(`${characterSelect} WHERE characters.id = ? AND characters.campaign_id = ?`)
  const insertCharacter = database.prepare(`
    INSERT INTO characters (
      id, campaign_id, player_id, name, concept, appearance, drive, capability, complication,
      possession, belief, secret, faction_id, faction_connection, location_id, location_connection,
      npc_id, npc_connection, connected_character_id, character_connection, generator_version,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateCharacter = database.prepare(`
    UPDATE characters SET name = ?, concept = ?, appearance = ?, drive = ?, capability = ?,
      complication = ?, possession = ?, belief = ?, secret = ?, faction_id = ?, faction_connection = ?,
      location_id = ?, location_connection = ?, npc_id = ?, npc_connection = ?,
      connected_character_id = ?, character_connection = ?, generator_version = ?,
      revision = revision + 1, updated_at = ?
    WHERE id = ? AND campaign_id = ? AND player_id = ? AND revision = ?
  `)
  const insertCharacterRevision = database.prepare('INSERT INTO character_revisions (id, character_id, revision, scene_id, reason, changed_fields, snapshot, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const characterRevisions = database.prepare(`
    SELECT character_revisions.*, campaign_scenes.title AS scene_title, players.name AS created_by_name
    FROM character_revisions
    LEFT JOIN campaign_scenes ON campaign_scenes.id = character_revisions.scene_id
    JOIN players ON players.id = character_revisions.created_by_player_id
    WHERE character_revisions.character_id = ? ORDER BY character_revisions.revision DESC
  `)
  const resolvedScenesForCharacter = database.prepare(`
    SELECT campaign_scenes.id, campaign_scenes.title, campaign_scenes.outcome, campaign_scenes.resolved_at
    FROM campaign_scene_characters
    JOIN campaign_scenes ON campaign_scenes.id = campaign_scene_characters.scene_id
    WHERE campaign_scene_characters.character_id = ? AND campaign_scenes.status = 'resolved'
    ORDER BY campaign_scenes.rowid DESC
  `)
  const resolvedSceneForCharacter = database.prepare(`
    SELECT campaign_scenes.id FROM campaign_scene_characters
    JOIN campaign_scenes ON campaign_scenes.id = campaign_scene_characters.scene_id
    WHERE campaign_scene_characters.character_id = ? AND campaign_scenes.id = ?
      AND campaign_scenes.campaign_id = ? AND campaign_scenes.status = 'resolved'
  `)
  const messageCharacter = database.prepare(`
    SELECT CASE WHEN rooms.slug = 'in-character' THEN characters.name ELSE NULL END AS character_name
    FROM rooms
    LEFT JOIN characters ON characters.player_id = ? AND characters.campaign_id = rooms.campaign_id
    WHERE rooms.id = ?
  `)
  const inCharacterRoom = database.prepare("SELECT * FROM rooms WHERE campaign_id = ? AND slug = 'in-character' AND archived_at IS NULL")
  const activeScene = database.prepare("SELECT campaign_scenes.*, creators.name AS created_by_name FROM campaign_scenes JOIN players AS creators ON creators.id = campaign_scenes.created_by_player_id WHERE campaign_scenes.campaign_id = ? AND campaign_scenes.status = 'active'")
  const scenesByCampaign = database.prepare("SELECT campaign_scenes.*, creators.name AS created_by_name, resolvers.name AS resolved_by_name FROM campaign_scenes JOIN players AS creators ON creators.id = campaign_scenes.created_by_player_id LEFT JOIN players AS resolvers ON resolvers.id = campaign_scenes.resolved_by_player_id WHERE campaign_scenes.campaign_id = ? ORDER BY campaign_scenes.rowid DESC LIMIT 20")
  const sceneCharacters = database.prepare('SELECT characters.id, characters.name, players.name AS player_name FROM campaign_scene_characters JOIN characters ON characters.id = campaign_scene_characters.character_id JOIN players ON players.id = characters.player_id WHERE campaign_scene_characters.scene_id = ? ORDER BY campaign_scene_characters.rowid')
  const insertScene = database.prepare('INSERT INTO campaign_scenes (id, campaign_id, title, framing, stakes, question, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const insertSceneCharacter = database.prepare('INSERT INTO campaign_scene_characters (scene_id, character_id) VALUES (?, ?)')
  const resolveScene = database.prepare("UPDATE campaign_scenes SET status = 'resolved', outcome = ?, resolved_by_player_id = ?, resolved_at = ? WHERE id = ? AND campaign_id = ? AND status = 'active'")
  const closedCampaignSessions = database.prepare(`
    SELECT campaign_sessions.*, players.name AS closed_by_name
    FROM campaign_sessions JOIN players ON players.id = campaign_sessions.closed_by_player_id
    WHERE campaign_sessions.campaign_id = ? ORDER BY campaign_sessions.end_sequence DESC
  `)
  const currentCampaignSessionBounds = database.prepare(`
    SELECT MIN(messages.rowid) AS start_sequence, MAX(messages.rowid) AS end_sequence, COUNT(*) AS message_count
    FROM messages JOIN rooms ON rooms.id = messages.room_id
    WHERE rooms.campaign_id = ? AND messages.rowid > COALESCE((
      SELECT MAX(end_sequence) FROM campaign_sessions WHERE campaign_id = ?
    ), 0)
  `)
  const campaignSessionParticipants = database.prepare(`
    SELECT DISTINCT players.id, players.name
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE rooms.campaign_id = ? AND messages.rowid BETWEEN ? AND ?
    ORDER BY players.name COLLATE NOCASE
  `)
  const campaignSessionMessageCount = database.prepare(`
    SELECT COUNT(*) AS message_count
    FROM messages JOIN rooms ON rooms.id = messages.room_id
    WHERE rooms.campaign_id = ? AND messages.rowid BETWEEN ? AND ?
  `)
  const campaignSessionMessages = database.prepare(`
    SELECT messages.id, rooms.id AS room_id, rooms.name AS room_name,
           COALESCE(messages.character_name, players.name) AS sender_name, messages.text, messages.sent_at,
           messages.rowid AS sequence
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE rooms.campaign_id = ? AND messages.rowid BETWEEN ? AND ?
    ORDER BY messages.rowid LIMIT ?
  `)
  const insertCampaignSession = database.prepare(`
    INSERT INTO campaign_sessions (id, campaign_id, title, start_sequence, end_sequence, closed_by_player_id, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const latestCanonConstitution = database.prepare(`
    SELECT canon_constitution_revisions.*, players.name AS updated_by_name
    FROM canon_constitution_revisions
    LEFT JOIN players ON players.id = canon_constitution_revisions.player_id
    WHERE canon_constitution_revisions.campaign_id = ?
    ORDER BY canon_constitution_revisions.revision DESC LIMIT 1
  `)
  const insertCanonConstitutionRevision = database.prepare(`
    INSERT INTO canon_constitution_revisions (
      campaign_id, revision, canon_threshold, player_declarations, ooc_policy,
      correction_policy, default_visibility, guidance, player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const latestMessagesForRoom = database.prepare(`
    SELECT * FROM (
      SELECT messages.id, messages.client_message_id, messages.player_id,
             COALESCE(messages.character_name, players.name) AS sender_name,
             players.name AS player_name, messages.character_name, messages.kind, messages.metadata,
             messages.text, messages.sent_at, messages.rowid AS sequence
      FROM messages JOIN players ON players.id = messages.player_id
      WHERE messages.room_id = ?
      ORDER BY messages.rowid DESC LIMIT ?
    ) ORDER BY sequence ASC
  `)
  const olderMessagesForRoom = database.prepare(`
    SELECT * FROM (
      SELECT messages.id, messages.client_message_id, messages.player_id,
             COALESCE(messages.character_name, players.name) AS sender_name,
             players.name AS player_name, messages.character_name, messages.kind, messages.metadata,
             messages.text, messages.sent_at, messages.rowid AS sequence
      FROM messages JOIN players ON players.id = messages.player_id
      WHERE messages.room_id = ? AND messages.rowid < ?
      ORDER BY messages.rowid DESC LIMIT ?
    ) ORDER BY sequence ASC
  `)
  const newestRoomSequence = database.prepare('SELECT COALESCE(MAX(rowid), 0) AS sequence FROM messages WHERE room_id = ?')
  const upsertRoomRead = database.prepare(`
    INSERT INTO room_reads (player_id, room_id, last_read_sequence, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(player_id, room_id) DO UPDATE SET
      last_read_sequence = MAX(room_reads.last_read_sequence, excluded.last_read_sequence),
      updated_at = excluded.updated_at
  `)
  const unreadRoomsForPlayer = database.prepare(`
    SELECT rooms.id AS room_id, COUNT(messages.id) AS unread
    FROM rooms
    LEFT JOIN room_reads ON room_reads.room_id = rooms.id AND room_reads.player_id = ?
    LEFT JOIN messages ON messages.room_id = rooms.id
      AND messages.rowid > COALESCE(room_reads.last_read_sequence, 0)
      AND messages.player_id <> ?
    WHERE rooms.campaign_id = ? AND rooms.archived_at IS NULL
    GROUP BY rooms.id
  `)
  const searchMessagesForCampaign = database.prepare(`
    SELECT messages.id, messages.room_id, rooms.name AS room_name, messages.player_id,
           COALESCE(messages.character_name, players.name) AS sender_name, messages.text, messages.sent_at, messages.rowid AS sequence
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE rooms.campaign_id = ? AND instr(lower(messages.text), lower(?)) > 0
    ORDER BY messages.rowid DESC
    LIMIT 50
  `)
  const recentMessagesForCampaign = database.prepare(`
    SELECT * FROM (
      SELECT messages.id, rooms.id AS room_id, rooms.name AS room_name,
             COALESCE(messages.character_name, players.name) AS sender_name, messages.text, messages.sent_at,
             messages.rowid AS sequence
      FROM messages
      JOIN rooms ON rooms.id = messages.room_id
      JOIN players ON players.id = messages.player_id
      WHERE rooms.campaign_id = ?
      ORDER BY messages.rowid DESC LIMIT ?
    ) ORDER BY sequence ASC
  `)
  const messagesAfterSequenceForCampaign = database.prepare(`
    SELECT messages.id, rooms.id AS room_id, rooms.name AS room_name,
           COALESCE(messages.character_name, players.name) AS sender_name, messages.text, messages.sent_at,
           messages.rowid AS sequence
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE rooms.campaign_id = ? AND messages.rowid > ?
    ORDER BY messages.rowid ASC LIMIT ?
  `)
  const canonScanState = database.prepare(`
    SELECT last_scanned_sequence, updated_at FROM canon_scan_state WHERE campaign_id = ?
  `)
  const campaignMessageCoverage = database.prepare(`
    SELECT COALESCE(MAX(messages.rowid), 0) AS latest_sequence,
           COUNT(CASE WHEN messages.rowid > ? THEN 1 END) AS unscanned_count
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    WHERE rooms.campaign_id = ?
  `)
  const upsertCanonScanState = database.prepare(`
    INSERT INTO canon_scan_state (campaign_id, last_scanned_sequence, updated_by_player_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET
      last_scanned_sequence = MAX(canon_scan_state.last_scanned_sequence, excluded.last_scanned_sequence),
      updated_by_player_id = excluded.updated_by_player_id,
      updated_at = excluded.updated_at
  `)
  const messageForCampaign = database.prepare(`
    SELECT messages.id, messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM messages
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE messages.id = ? AND rooms.campaign_id = ?
  `)
  const insertCanonProposal = database.prepare(`
    INSERT INTO canon_proposals (
      id, campaign_id, kind, title, claim, visibility, confidence, status,
      extractor_version, extraction_key, created_by_player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)
  `)
  const insertCanonProposalSource = database.prepare(`
    INSERT INTO canon_proposal_sources (proposal_id, message_id, excerpt) VALUES (?, ?, ?)
  `)
  const insertCanonProposalSourceIfNew = database.prepare(`
    INSERT OR IGNORE INTO canon_proposal_sources (proposal_id, message_id, excerpt) VALUES (?, ?, ?)
  `)
  const canonProposalById = database.prepare(`
    SELECT canon_proposals.*, players.name AS created_by_name
    FROM canon_proposals
    LEFT JOIN players ON players.id = canon_proposals.created_by_player_id
    WHERE canon_proposals.id = ? AND canon_proposals.campaign_id = ?
  `)
  const canonProposalsForCampaign = database.prepare(`
    SELECT canon_proposals.*, players.name AS created_by_name
    FROM canon_proposals
    LEFT JOIN players ON players.id = canon_proposals.created_by_player_id
    WHERE canon_proposals.campaign_id = ?
    ORDER BY canon_proposals.rowid DESC
  `)
  const canonProposalByExtractionKey = database.prepare(`
    SELECT canon_proposals.*, players.name AS created_by_name
    FROM canon_proposals
    LEFT JOIN players ON players.id = canon_proposals.created_by_player_id
    WHERE canon_proposals.campaign_id = ? AND canon_proposals.extraction_key = ?
  `)
  const canonProposalCandidates = database.prepare(`
    SELECT canon_proposals.id, canon_proposals.kind,
           CASE WHEN canon_proposals.status = 'accepted' THEN canon_entries.title ELSE canon_proposals.title END AS title,
           CASE WHEN canon_proposals.status = 'accepted' THEN canon_entries.claim ELSE canon_proposals.claim END AS claim,
           canon_proposals.status
    FROM canon_proposals
    LEFT JOIN canon_entries ON canon_entries.proposal_id = canon_proposals.id AND canon_entries.status = 'active'
    WHERE canon_proposals.campaign_id = ?
      AND canon_proposals.kind = ?
      AND (canon_proposals.status != 'accepted' OR canon_entries.id IS NOT NULL)
    ORDER BY canon_proposals.rowid DESC
  `)
  const insertCanonProposalMatch = database.prepare(`
    INSERT INTO canon_proposal_matches (
      id, campaign_id, matched_proposal_id, extractor_version, outcome, matched_status, similarity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const canonProposalMatchMetrics = database.prepare(`
    SELECT extractor_version,
           COUNT(*) AS total,
           SUM(outcome = 'existing') AS existing,
           SUM(outcome = 'merged') AS merged,
           SUM(outcome = 'suppressed') AS suppressed
    FROM canon_proposal_matches
    WHERE (? IS NULL OR campaign_id = ?)
    GROUP BY extractor_version
    ORDER BY extractor_version
  `)
  const canonSourcesForProposal = database.prepare(`
    SELECT canon_proposal_sources.message_id, canon_proposal_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM canon_proposal_sources
    JOIN messages ON messages.id = canon_proposal_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE canon_proposal_sources.proposal_id = ?
    ORDER BY messages.rowid
  `)
  const updateCanonProposalStatus = database.prepare(`
    UPDATE canon_proposals SET status = ? WHERE id = ? AND campaign_id = ? AND status = 'proposed'
  `)
  const insertCanonDecision = database.prepare(`
    INSERT INTO canon_decisions (
      id, proposal_id, player_id, action, reason, accepted_title, accepted_claim, accepted_visibility, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const canonDecisionExamples = database.prepare(`
    SELECT canon_proposals.kind, canon_proposals.title, canon_proposals.claim,
           canon_proposals.extractor_version, canon_decisions.action, canon_decisions.reason,
           canon_decisions.accepted_title, canon_decisions.accepted_claim,
           canon_decisions.accepted_visibility, canon_decisions.created_at
    FROM canon_decisions
    JOIN canon_proposals ON canon_proposals.id = canon_decisions.proposal_id
    WHERE canon_proposals.campaign_id = ?
    ORDER BY canon_decisions.rowid DESC LIMIT ?
  `)
  const canonFeedbackForExport = database.prepare(`
    SELECT canon_proposals.id AS proposal_id, canon_proposals.campaign_id,
           canon_proposals.kind, canon_proposals.title, canon_proposals.claim,
           canon_proposals.visibility, canon_proposals.confidence,
           canon_proposals.extractor_version, canon_proposals.created_at,
           canon_decisions.action, canon_decisions.reason,
           canon_decisions.accepted_title, canon_decisions.accepted_claim,
           canon_decisions.accepted_visibility, canon_decisions.created_at AS decided_at
    FROM canon_decisions
    JOIN canon_proposals ON canon_proposals.id = canon_decisions.proposal_id
    WHERE (? IS NULL OR canon_proposals.campaign_id = ?)
    ORDER BY canon_proposals.campaign_id, canon_decisions.rowid
  `)
  const insertCanonEntry = database.prepare(`
    INSERT INTO canon_entries (
      id, proposal_id, campaign_id, kind, title, claim, visibility, revision,
      status, created_by_player_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
  `)
  const canonEntryById = database.prepare(`
    SELECT canon_entries.*, players.name AS created_by_name,
           (SELECT reason FROM canon_entry_revisions WHERE entry_id = canon_entries.id ORDER BY revision DESC LIMIT 1) AS latest_reason
    FROM canon_entries
    JOIN players ON players.id = canon_entries.created_by_player_id
    WHERE canon_entries.id = ? AND canon_entries.campaign_id = ?
  `)
  const canonEntriesForCampaign = database.prepare(`
    SELECT canon_entries.*, players.name AS created_by_name,
           (SELECT reason FROM canon_entry_revisions WHERE entry_id = canon_entries.id ORDER BY revision DESC LIMIT 1) AS latest_reason
    FROM canon_entries
    JOIN players ON players.id = canon_entries.created_by_player_id
    WHERE canon_entries.campaign_id = ? AND canon_entries.status = 'active'
    ORDER BY canon_entries.rowid DESC
  `)
  const canonSourcesForEntry = database.prepare(`
    SELECT canon_proposal_sources.message_id, canon_proposal_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM canon_entries
    JOIN canon_proposal_sources ON canon_proposal_sources.proposal_id = canon_entries.proposal_id
    JOIN messages ON messages.id = canon_proposal_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE canon_entries.id = ?
    ORDER BY messages.rowid
  `)
  const canonAudiencesForEntry = database.prepare(`
    SELECT players.id, players.name FROM canon_entry_audiences
    JOIN players ON players.id = canon_entry_audiences.player_id
    WHERE canon_entry_audiences.entry_id = ? ORDER BY players.name
  `)
  const canonAudiencesForRevision = database.prepare(`
    SELECT players.id, players.name FROM canon_revision_audiences
    JOIN players ON players.id = canon_revision_audiences.player_id
    WHERE canon_revision_audiences.revision_id = ? ORDER BY players.name
  `)
  const insertCanonEntryAudience = database.prepare('INSERT INTO canon_entry_audiences (entry_id, player_id) VALUES (?, ?)')
  const deleteCanonEntryAudiences = database.prepare('DELETE FROM canon_entry_audiences WHERE entry_id = ?')
  const insertCanonRevisionAudience = database.prepare('INSERT INTO canon_revision_audiences (revision_id, player_id) VALUES (?, ?)')
  const insertCanonEntryRevision = database.prepare(`
    INSERT INTO canon_entry_revisions (
      id, entry_id, revision, action, title, claim, visibility, reason, player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateCanonEntry = database.prepare(`
    UPDATE canon_entries
    SET title = ?, claim = ?, visibility = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND campaign_id = ? AND revision = ? AND status = 'active'
  `)
  const retractCanonEntry = database.prepare(`
    UPDATE canon_entries
    SET status = 'superseded', retired_reason = 'retracted', revision = revision + 1, updated_at = ?
    WHERE id = ? AND campaign_id = ? AND revision = ? AND status = 'active'
  `)
  const canonRevisionsForEntry = database.prepare(`
    SELECT canon_entry_revisions.*, players.name AS created_by_name
    FROM canon_entry_revisions
    JOIN players ON players.id = canon_entry_revisions.player_id
    WHERE canon_entry_revisions.entry_id = ?
    ORDER BY canon_entry_revisions.revision DESC
  `)
  const insertContinuityBrief = database.prepare(`
    INSERT INTO continuity_briefs (
      id, campaign_id, preparation_run_id, generator_version, session_id, session_title, session_status,
      session_start_sequence, session_end_sequence, created_by_player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const continuityBriefForPreparationRun = database.prepare('SELECT id FROM continuity_briefs WHERE preparation_run_id = ?')
  const insertContradictionReport = database.prepare(`
    INSERT INTO contradiction_reports (
      id, campaign_id, generator_version, session_id, session_title, session_status,
      session_start_sequence, session_end_sequence, created_by_player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContradictionFinding = database.prepare(`
    INSERT INTO contradiction_findings (id, report_id, position, canon_entry_id, canon_title, canon_claim, title, explanation, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContradictionSource = database.prepare(`
    INSERT INTO contradiction_sources (finding_id, message_id, excerpt) VALUES (?, ?, ?)
  `)
  const latestContradictionReport = database.prepare(`
    SELECT contradiction_reports.*, players.name AS created_by_name
    FROM contradiction_reports
    JOIN players ON players.id = contradiction_reports.created_by_player_id
    WHERE contradiction_reports.campaign_id = ?
    ORDER BY contradiction_reports.rowid DESC LIMIT 1
  `)
  const contradictionFindingsForReport = database.prepare(`
    SELECT * FROM contradiction_findings WHERE report_id = ? ORDER BY position
  `)
  const contradictionSourcesForFinding = database.prepare(`
    SELECT contradiction_sources.message_id, contradiction_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM contradiction_sources
    JOIN messages ON messages.id = contradiction_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE contradiction_sources.finding_id = ?
    ORDER BY messages.rowid
  `)
  const insertContinuityThread = database.prepare(`
    INSERT INTO continuity_threads (id, brief_id, position, title, summary, why_it_matters, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContinuitySource = database.prepare(`
    INSERT INTO continuity_thread_sources (thread_id, message_id, excerpt) VALUES (?, ?, ?)
  `)
  const latestContinuityBrief = database.prepare(`
    SELECT continuity_briefs.*, players.name AS created_by_name
    FROM continuity_briefs
    JOIN players ON players.id = continuity_briefs.created_by_player_id
    WHERE continuity_briefs.campaign_id = ?
    ORDER BY continuity_briefs.rowid DESC LIMIT 1
  `)
  const continuityThreadsForBrief = database.prepare(`
    SELECT * FROM continuity_threads WHERE brief_id = ? ORDER BY position
  `)
  const continuitySourcesForThread = database.prepare(`
    SELECT continuity_thread_sources.message_id, continuity_thread_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM continuity_thread_sources
    JOIN messages ON messages.id = continuity_thread_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id
    JOIN players ON players.id = messages.player_id
    WHERE continuity_thread_sources.thread_id = ?
    ORDER BY messages.rowid
  `)
  const continuityFeedbackForThread = database.prepare(`
    SELECT rating, created_at FROM continuity_feedback WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1
  `)
  const continuityTransitionsForThread = database.prepare(`
    SELECT continuity_thread_transitions.*, players.name AS created_by_name
    FROM continuity_thread_transitions
    JOIN players ON players.id = continuity_thread_transitions.player_id
    WHERE continuity_thread_transitions.thread_id = ?
    ORDER BY continuity_thread_transitions.rowid DESC
  `)
  const insertContinuityTransition = database.prepare(`
    INSERT INTO continuity_thread_transitions (id, thread_id, status, reason, player_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const continuityThreadForCampaign = database.prepare(`
    SELECT continuity_threads.* FROM continuity_threads
    JOIN continuity_briefs ON continuity_briefs.id = continuity_threads.brief_id
    WHERE continuity_threads.id = ? AND continuity_briefs.campaign_id = ?
  `)
  const insertContinuityFeedback = database.prepare(`
    INSERT INTO continuity_feedback (id, thread_id, player_id, rating, created_at) VALUES (?, ?, ?, ?, ?)
  `)
  const continuityFeedbackForExport = database.prepare(`
    SELECT continuity_threads.id AS thread_id, continuity_briefs.campaign_id,
           continuity_briefs.generator_version, continuity_briefs.created_at,
           continuity_threads.title, continuity_threads.summary,
           continuity_threads.why_it_matters, continuity_threads.confidence,
           continuity_feedback.rating, continuity_feedback.created_at AS rated_at
    FROM continuity_feedback
    JOIN continuity_threads ON continuity_threads.id = continuity_feedback.thread_id
    JOIN continuity_briefs ON continuity_briefs.id = continuity_threads.brief_id
    WHERE continuity_feedback.rowid = (
      SELECT MAX(latest.rowid) FROM continuity_feedback AS latest
      WHERE latest.thread_id = continuity_feedback.thread_id
    ) AND (? IS NULL OR continuity_briefs.campaign_id = ?)
    ORDER BY continuity_briefs.campaign_id, continuity_feedback.rowid
  `)
  const insertSessionRecap = database.prepare(`
    INSERT INTO session_recaps (
      id, campaign_id, preparation_run_id, generator_version, public_summary, gm_notes, session_id, session_title,
      session_status, session_start_sequence, session_end_sequence, created_by_player_id, created_at,
      updated_by_player_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const sessionRecapForPreparationRun = database.prepare('SELECT id FROM session_recaps WHERE preparation_run_id = ?')
  const insertSessionRecapRevision = database.prepare(`INSERT INTO session_recap_revisions (id, recap_id, revision, public_summary, gm_notes, player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insertSessionRecapSource = database.prepare('INSERT INTO session_recap_sources (recap_id, message_id, excerpt) VALUES (?, ?, ?)')
  const latestSessionRecap = database.prepare(`SELECT session_recaps.*, players.name AS updated_by_name FROM session_recaps LEFT JOIN players ON players.id = session_recaps.updated_by_player_id WHERE session_recaps.campaign_id = ? ORDER BY session_recaps.rowid DESC LIMIT 1`)
  const latestPublishedSessionRecap = database.prepare(`SELECT session_recaps.*, players.name AS updated_by_name FROM session_recaps LEFT JOIN players ON players.id = session_recaps.updated_by_player_id WHERE session_recaps.campaign_id = ? AND session_recaps.status = 'published' ORDER BY session_recaps.rowid DESC LIMIT 1`)
  const sessionRecapById = database.prepare('SELECT * FROM session_recaps WHERE id = ? AND campaign_id = ?')
  const updateSessionRecap = database.prepare("UPDATE session_recaps SET public_summary = ?, gm_notes = ?, revision = revision + 1, updated_by_player_id = ?, updated_at = ? WHERE id = ? AND campaign_id = ? AND status = 'draft' AND revision = ?")
  const sessionRecapRevisions = database.prepare(`SELECT session_recap_revisions.*, players.name AS created_by_name FROM session_recap_revisions JOIN players ON players.id = session_recap_revisions.player_id WHERE recap_id = ? ORDER BY revision DESC`)
  const publishSessionRecap = database.prepare("UPDATE session_recaps SET status = 'published', published_by_player_id = ?, published_at = ? WHERE id = ? AND campaign_id = ? AND status = 'draft'")
  const sessionRecapSources = database.prepare(`
    SELECT session_recap_sources.message_id, session_recap_sources.excerpt, messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM session_recap_sources JOIN messages ON messages.id = session_recap_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id JOIN players ON players.id = messages.player_id
    WHERE session_recap_sources.recap_id = ? ORDER BY messages.rowid
  `)
  const insertAiEvaluationRun = database.prepare(`INSERT INTO ai_evaluation_runs (id, campaign_id, suite, model, generator_version, passed, total, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const aiEvaluationRuns = database.prepare(`SELECT * FROM ai_evaluation_runs WHERE (? IS NULL OR campaign_id = ?) ORDER BY rowid DESC LIMIT ?`)
  const insertAiInferenceRun = database.prepare(`INSERT INTO ai_inference_runs (id, campaign_id, surface, generator_version, status, duration_ms, input_units, output_units, error_category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const aiInferenceRuns = database.prepare(`SELECT * FROM ai_inference_runs WHERE campaign_id = ? ORDER BY rowid DESC LIMIT ?`)
  const intelligenceSettings = database.prepare('SELECT * FROM campaign_intelligence_settings WHERE campaign_id = ?')
  const insertIntelligenceSettings = database.prepare('INSERT INTO campaign_intelligence_settings (campaign_id) VALUES (?)')
  const updateIntelligenceSettings = database.prepare(`UPDATE campaign_intelligence_settings SET auto_prepare = ?, prepare_canon = ?, prepare_continuity = ?, prepare_recap = ?, updated_by_player_id = ?, updated_at = ? WHERE campaign_id = ?`)
  const insertPreparationRun = database.prepare(`INSERT OR IGNORE INTO preparation_runs (id, campaign_id, session_id, status, tasks, requested_by_player_id, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)`)
  const insertPreparationRunTask = database.prepare(`INSERT INTO preparation_run_tasks (run_id, task) VALUES (?, ?)`)
  const preparationRunForSession = database.prepare('SELECT * FROM preparation_runs WHERE campaign_id = ? AND session_id = ?')
  const preparationRunById = database.prepare('SELECT * FROM preparation_runs WHERE id = ? AND campaign_id = ?')
  const preparationRuns = database.prepare('SELECT * FROM preparation_runs WHERE campaign_id = ? ORDER BY rowid DESC LIMIT ?')
  const resumablePreparationRuns = database.prepare("SELECT * FROM preparation_runs WHERE status IN ('queued', 'running') ORDER BY rowid")
  const preparationTasks = database.prepare('SELECT * FROM preparation_run_tasks WHERE run_id = ? ORDER BY rowid')
  const startPreparationTask = database.prepare("UPDATE preparation_run_tasks SET status = 'running', attempts = attempts + 1, error = NULL, started_at = ?, completed_at = NULL WHERE run_id = ? AND task = ? AND status = 'queued'")
  const finishPreparationTask = database.prepare("UPDATE preparation_run_tasks SET status = ?, result = ?, error = ?, completed_at = ? WHERE run_id = ? AND task = ? AND status = 'running'")
  const resetRunningPreparationTasks = database.prepare("UPDATE preparation_run_tasks SET status = 'queued', started_at = NULL WHERE status = 'running'")
  const resetFailedPreparationTasks = database.prepare("UPDATE preparation_run_tasks SET status = 'queued', error = NULL, started_at = NULL, completed_at = NULL WHERE run_id = ? AND status = 'failed'")
  const updatePreparationRunState = database.prepare('UPDATE preparation_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?')
  const continuityOutcomeForBrief = database.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN (SELECT rating FROM continuity_feedback WHERE thread_id = continuity_threads.id ORDER BY rowid DESC LIMIT 1) IS NOT NULL THEN 1 ELSE 0 END) AS rated,
      SUM(CASE WHEN (SELECT rating FROM continuity_feedback WHERE thread_id = continuity_threads.id ORDER BY rowid DESC LIMIT 1) = 'useful' THEN 1 ELSE 0 END) AS useful,
      SUM(CASE WHEN (SELECT rating FROM continuity_feedback WHERE thread_id = continuity_threads.id ORDER BY rowid DESC LIMIT 1) IN ('incorrect', 'secret_leak', 'not_useful') THEN 1 ELSE 0 END) AS issues
    FROM continuity_threads WHERE brief_id = ?
  `)
  const insertKnowledgeAnswer = database.prepare('INSERT INTO knowledge_answers (id, campaign_id, subject_player_id, requested_by_player_id, question, answer, generator_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const insertKnowledgeAnswerSource = database.prepare('INSERT INTO knowledge_answer_sources (answer_id, canon_entry_id) VALUES (?, ?)')
  const knowledgeAnswerForRequester = database.prepare('SELECT * FROM knowledge_answers WHERE id = ? AND campaign_id = ? AND requested_by_player_id = ?')
  const insertKnowledgeAnswerFeedback = database.prepare('INSERT INTO knowledge_answer_feedback (id, answer_id, player_id, rating, created_at) VALUES (?, ?, ?, ?, ?)')
  const knowledgeFeedbackExamples = database.prepare(`
    SELECT knowledge_answers.question, knowledge_answers.generator_version, knowledge_answer_feedback.rating
    FROM knowledge_answer_feedback JOIN knowledge_answers ON knowledge_answers.id = knowledge_answer_feedback.answer_id
    WHERE knowledge_answers.campaign_id = ? AND knowledge_answers.subject_player_id = ?
      AND knowledge_answer_feedback.rowid = (SELECT MAX(latest.rowid) FROM knowledge_answer_feedback AS latest WHERE latest.answer_id = knowledge_answers.id)
    ORDER BY knowledge_answer_feedback.rowid DESC LIMIT ?
  `)
  const knowledgeFeedbackForCampaign = database.prepare(`
    SELECT knowledge_answers.id AS answer_id, knowledge_answers.question, knowledge_answers.answer,
           knowledge_answers.generator_version, knowledge_answers.created_at,
           knowledge_answer_feedback.rating, knowledge_answer_feedback.created_at AS rated_at
    FROM knowledge_answer_feedback JOIN knowledge_answers ON knowledge_answers.id = knowledge_answer_feedback.answer_id
    WHERE knowledge_answers.campaign_id = ?
      AND knowledge_answer_feedback.rowid = (SELECT MAX(latest.rowid) FROM knowledge_answer_feedback AS latest WHERE latest.answer_id = knowledge_answers.id)
    ORDER BY knowledge_answer_feedback.rowid
  `)
  const knowledgeAnswerSources = database.prepare('SELECT canon_entry_id FROM knowledge_answer_sources WHERE answer_id = ? ORDER BY rowid')
  const insertHouseRule = database.prepare(`INSERT INTO house_rules (id, campaign_id, title, source_rule, interpretation, ruling, created_by_player_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertHouseRuleRevision = database.prepare(`INSERT INTO house_rule_revisions (id, rule_id, revision, title, source_rule, interpretation, ruling, status, reason, player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const houseRules = database.prepare('SELECT * FROM house_rules WHERE campaign_id = ? ORDER BY status, title COLLATE NOCASE')
  const houseRuleForCampaign = database.prepare('SELECT * FROM house_rules WHERE id = ? AND campaign_id = ?')
  const insertHouseRuleProposal = database.prepare(`INSERT INTO house_rule_proposals (id, campaign_id, session_id, generator_version, title, source_rule, interpretation, ruling, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertHouseRuleProposalSource = database.prepare('INSERT INTO house_rule_proposal_sources (proposal_id, message_id, excerpt) VALUES (?, ?, ?)')
  const houseRuleProposals = database.prepare(`SELECT house_rule_proposals.*, creators.name AS created_by_name, deciders.name AS decided_by_name FROM house_rule_proposals JOIN players AS creators ON creators.id = house_rule_proposals.created_by_player_id LEFT JOIN players AS deciders ON deciders.id = house_rule_proposals.decided_by_player_id WHERE house_rule_proposals.campaign_id = ? ORDER BY house_rule_proposals.rowid DESC`)
  const houseRuleProposalsForExport = database.prepare(`SELECT * FROM house_rule_proposals WHERE status != 'proposed' AND (? IS NULL OR campaign_id = ?) ORDER BY campaign_id, rowid`)
  const houseRuleProposalForCampaign = database.prepare('SELECT * FROM house_rule_proposals WHERE id = ? AND campaign_id = ?')
  const houseRuleProposalSources = database.prepare(`
    SELECT house_rule_proposal_sources.message_id, house_rule_proposal_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM house_rule_proposal_sources JOIN messages ON messages.id = house_rule_proposal_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id JOIN players ON players.id = messages.player_id
    WHERE house_rule_proposal_sources.proposal_id = ? ORDER BY messages.rowid
  `)
  const decideHouseRuleProposal = database.prepare(`UPDATE house_rule_proposals SET status = ?, decision_action = ?, decision_reason = ?, decided_title = ?, decided_source_rule = ?, decided_interpretation = ?, decided_ruling = ?, accepted_rule_id = ?, decided_by_player_id = ?, decided_at = ? WHERE id = ? AND campaign_id = ? AND status = 'proposed'`)
  const houseRuleRevisions = database.prepare(`SELECT house_rule_revisions.*, players.name AS player_name FROM house_rule_revisions JOIN players ON players.id = house_rule_revisions.player_id WHERE rule_id = ? ORDER BY revision DESC`)
  const insertHouseRuleRevisionSource = database.prepare('INSERT INTO house_rule_revision_sources (revision_id, message_id, excerpt) VALUES (?, ?, ?)')
  const houseRuleRevisionSources = database.prepare(`
    SELECT house_rule_revision_sources.message_id, house_rule_revision_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM house_rule_revision_sources JOIN messages ON messages.id = house_rule_revision_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id JOIN players ON players.id = messages.player_id
    WHERE house_rule_revision_sources.revision_id = ? ORDER BY messages.rowid
  `)
  const latestHouseRuleRevision = database.prepare('SELECT id FROM house_rule_revisions WHERE rule_id = ? ORDER BY revision DESC LIMIT 1')
  const updateHouseRule = database.prepare(`UPDATE house_rules SET title = ?, source_rule = ?, interpretation = ?, ruling = ?, status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND campaign_id = ? AND revision = ?`)
  const insertFactionClock = database.prepare(`INSERT INTO faction_clocks (id, campaign_id, name, goal, progress, segments, created_by_player_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const factionClocks = database.prepare('SELECT * FROM faction_clocks WHERE campaign_id = ? ORDER BY name COLLATE NOCASE')
  const factionClockForCampaign = database.prepare('SELECT * FROM faction_clocks WHERE id = ? AND campaign_id = ?')
  const insertFactionProposal = database.prepare(`INSERT INTO faction_clock_proposals (id, clock_id, summary, assumptions, base_progress, proposed_progress, session_id, generator_version, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertFactionProposalSource = database.prepare('INSERT INTO faction_clock_proposal_sources (proposal_id, message_id, excerpt) VALUES (?, ?, ?)')
  const factionProposalSources = database.prepare(`
    SELECT faction_clock_proposal_sources.message_id, faction_clock_proposal_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, COALESCE(messages.character_name, players.name) AS sender_name
    FROM faction_clock_proposal_sources JOIN messages ON messages.id = faction_clock_proposal_sources.message_id
    JOIN rooms ON rooms.id = messages.room_id JOIN players ON players.id = messages.player_id
    WHERE faction_clock_proposal_sources.proposal_id = ? ORDER BY messages.rowid
  `)
  const factionProposals = database.prepare(`SELECT faction_clock_proposals.*, creators.name AS created_by_name, deciders.name AS decided_by_name FROM faction_clock_proposals JOIN faction_clocks ON faction_clocks.id = faction_clock_proposals.clock_id JOIN players AS creators ON creators.id = faction_clock_proposals.created_by_player_id LEFT JOIN players AS deciders ON deciders.id = faction_clock_proposals.decided_by_player_id WHERE faction_clocks.campaign_id = ? ORDER BY faction_clock_proposals.rowid DESC`)
  const factionProposalForCampaign = database.prepare(`SELECT faction_clock_proposals.*, faction_clocks.progress, faction_clocks.segments FROM faction_clock_proposals JOIN faction_clocks ON faction_clocks.id = faction_clock_proposals.clock_id WHERE faction_clock_proposals.id = ? AND faction_clocks.campaign_id = ?`)
  const decideFactionProposal = database.prepare(`UPDATE faction_clock_proposals SET status = ?, decided_by_player_id = ?, decided_at = ? WHERE id = ? AND status = 'proposed'`)
  const advanceFactionClock = database.prepare(`UPDATE faction_clocks SET progress = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
  const latestMessageSequence = database.prepare('SELECT COALESCE(MAX(rowid), 0) AS sequence FROM messages')
  const upsertSpotlightConsent = database.prepare(`INSERT INTO spotlight_consents (player_id, enabled, start_sequence, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET enabled = excluded.enabled, start_sequence = excluded.start_sequence, updated_at = excluded.updated_at`)
  const insertSpotlightConsentEvent = database.prepare('INSERT INTO spotlight_consent_events (id, player_id, enabled, effective_sequence, created_at) VALUES (?, ?, ?, ?, ?)')
  const spotlightConsentForPlayer = database.prepare('SELECT enabled, updated_at FROM spotlight_consents WHERE player_id = ?')
  const spotlightConsentHistory = database.prepare('SELECT enabled, effective_sequence, created_at FROM spotlight_consent_events WHERE player_id = ? ORDER BY rowid DESC')
  const spotlightParticipants = database.prepare(`SELECT players.id, players.name, COALESCE(spotlight_consents.enabled, 0) AS enabled FROM players LEFT JOIN spotlight_consents ON spotlight_consents.player_id = players.id WHERE players.campaign_id = ? AND players.removed_at IS NULL ORDER BY players.rowid`)
  const spotlightMessageCounts = database.prepare(`
    SELECT players.id, players.name, COUNT(messages.id) AS message_count
    FROM players JOIN messages ON messages.player_id = players.id
    WHERE players.campaign_id = ? AND players.removed_at IS NULL AND messages.rowid BETWEEN ? AND ?
      AND 1 = (SELECT enabled FROM spotlight_consent_events WHERE player_id = players.id AND effective_sequence < messages.rowid ORDER BY rowid DESC LIMIT 1)
    GROUP BY players.id ORDER BY players.rowid
  `)
  const insertSpotlightReport = database.prepare('INSERT OR IGNORE INTO spotlight_reports (id, campaign_id, session_id, session_title, session_start_sequence, session_end_sequence, total_messages, created_by_player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const spotlightReportForSession = database.prepare('SELECT * FROM spotlight_reports WHERE campaign_id = ? AND session_id = ?')
  const insertSpotlightReportParticipant = database.prepare('INSERT INTO spotlight_report_participants (report_id, player_id, message_count, share) VALUES (?, ?, ?, ?)')
  const spotlightReportParticipants = database.prepare(`SELECT spotlight_report_participants.*, players.name FROM spotlight_report_participants JOIN players ON players.id = spotlight_report_participants.player_id WHERE report_id = ? ORDER BY players.rowid`)
  const spotlightReportsForPlayer = database.prepare(`SELECT spotlight_reports.* FROM spotlight_reports JOIN spotlight_report_participants ON spotlight_report_participants.report_id = spotlight_reports.id WHERE spotlight_report_participants.player_id = ? ORDER BY spotlight_reports.rowid DESC`)
  const recentPlayerMessages = database.prepare(`SELECT messages.text, messages.sent_at FROM messages JOIN rooms ON rooms.id = messages.room_id WHERE rooms.campaign_id = ? AND messages.player_id = ? ORDER BY messages.rowid DESC LIMIT ?`)

  function publicSpotlightReport(row) {
    const participants = spotlightReportParticipants.all(row.id).map((participant) => ({
      id: participant.player_id, name: participant.name, messages: participant.message_count, share: participant.share,
    }))
    return {
      id: row.id,
      session: { id: row.session_id, title: row.session_title, status: 'closed', startSequence: row.session_start_sequence, endSequence: row.session_end_sequence },
      basis: 'opted_in_text_messages', participants, totalMessages: row.total_messages,
      createdAt: row.created_at,
    }
  }

  function preparationRunWithOutcomes(row) {
    const run = publicPreparationRun(row, preparationTasks.all(row.id))
    return {
      ...run,
      tasks: run.tasks.map((task) => {
        const result = task.result
        if (task.name === 'canon' && Array.isArray(result?.artifactIds)) {
          const statuses = result.artifactIds.map((id) => canonProposalById.get(id, row.campaign_id)?.status).filter(Boolean)
          return { ...task, outcome: { total: statuses.length, awaiting: statuses.filter((status) => status === 'proposed').length, accepted: statuses.filter((status) => status === 'accepted').length, disputed: statuses.filter((status) => status === 'disputed').length, rejected: statuses.filter((status) => status === 'rejected').length } }
        }
        if (task.name === 'continuity' && typeof result?.id === 'string') {
          const outcome = continuityOutcomeForBrief.get(result.id)
          return { ...task, outcome: { total: outcome.total, rated: outcome.rated, useful: outcome.useful, issues: outcome.issues } }
        }
        if (task.name === 'recap' && typeof result?.id === 'string') {
          const recap = sessionRecapById.get(result.id, row.campaign_id)
          return { ...task, outcome: recap ? { status: recap.status, revision: recap.revision } : null }
        }
        return { ...task, outcome: null }
      }),
    }
  }

  function createPlayer(campaignId, name, role = 'member') {
    const token = randomBytes(32).toString('base64url')
    const recoveryCode = createRecoveryCode()
    const knowledgeRole = role === 'owner' ? 'gm' : 'player'
    const player = { id: randomUUID(), campaignId, name, role, knowledgeRole, token, recoveryCode }
    insertPlayer.run(player.id, campaignId, name, role, knowledgeRole, tokenHash(token), recoveryHash(recoveryCode), new Date().toISOString())
    initializePlayerReads.run(new Date().toISOString())
    return player
  }

  function campaignWorldCollections(campaignId) {
    return {
      truths: campaignWorldTruths.all(campaignId),
      factions: campaignWorldFactions.all(campaignId),
      locations: campaignWorldLocations.all(campaignId),
      npcs: campaignWorldNpcs.all(campaignId),
      hooks: campaignWorldHooks.all(campaignId),
    }
  }

  function replaceCampaignWorldCollections(campaignId, world) {
    clearCampaignWorldTruths.run(campaignId)
    clearCampaignWorldFactions.run(campaignId)
    clearCampaignWorldLocations.run(campaignId)
    clearCampaignWorldNpcs.run(campaignId)
    clearCampaignWorldHooks.run(campaignId)
    world.truths.forEach((item, position) => insertCampaignWorldTruth.run(item.id ?? randomUUID(), campaignId, position, item.text))
    world.factions.forEach((item, position) => insertCampaignWorldFaction.run(item.id ?? randomUUID(), campaignId, position, item.name, item.goal, item.opposition))
    world.locations.forEach((item, position) => insertCampaignWorldLocation.run(item.id ?? randomUUID(), campaignId, position, item.name, item.description, item.danger))
    world.npcs.forEach((item, position) => insertCampaignWorldNpc.run(item.id ?? randomUUID(), campaignId, position, item.name, item.role, item.want, item.leverage))
    world.hooks.forEach((item, position) => insertCampaignWorldHook.run(item.id ?? randomUUID(), campaignId, position, item.title, item.situation))
  }

  function characterSnapshot(row) {
    const character = publicCharacter(row, { includeSecret: true })
    const { id, campaignId, playerId, playerName, revision, createdAt, updatedAt, ...snapshot } = character
    return snapshot
  }

  function privateCharacter(row) {
    if (!row) return null
    return {
      ...publicCharacter(row, { includeSecret: true }),
      revisions: characterRevisions.all(row.id).map(publicCharacterRevision),
      aftermathScenes: resolvedScenesForCharacter.all(row.id).map((scene) => ({ id: scene.id, title: scene.title, outcome: scene.outcome, resolvedAt: scene.resolved_at })),
    }
  }

  for (const row of allCharacters.all()) {
    if (characterRevisions.get(row.id)) continue
    const snapshot = characterSnapshot(row)
    insertCharacterRevision.run(randomUUID(), row.id, row.revision, null, 'Character history began.', JSON.stringify(Object.keys(snapshot)), JSON.stringify(snapshot), row.player_id, row.updated_at)
  }

  return {
    health() {
      return database.prepare('SELECT 1 AS healthy').get().healthy === 1
    },

    createCampaign(campaignName, playerName) {
      const campaign = { id: randomUUID(), name: campaignName, inviteCode: randomBytes(5).toString('hex') }
      database.exec('BEGIN IMMEDIATE')
      try {
        insertCampaign.run(campaign.id, campaign.name, campaign.inviteCode, new Date().toISOString())
        defaultRooms.forEach(([slug, name, description], position) => insertRoom.run(randomUUID(), campaign.id, slug, name, description, position))
        const { recoveryCode, ...player } = createPlayer(campaign.id, playerName, 'owner')
        insertCampaignNote.run(campaign.id)
        insertDefaultCanonConstitution.run(campaign.id, player.id, new Date().toISOString())
        insertIntelligenceSettings.run(campaign.id)
        database.exec('COMMIT')
        return { campaign: publicCampaign(campaignById.get(campaign.id), roomsByCampaign.all(campaign.id)), player, recoveryCode }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    joinCampaign(inviteCode, playerName) {
      const row = campaignByInvite.get(inviteCode)
      if (!row) return null
      if (activePlayerByName.get(row.id, playerName)) return { duplicate: true }
      const { recoveryCode, ...player } = createPlayer(row.id, playerName)
      return { campaign: publicCampaign(row, roomsByCampaign.all(row.id)), player, recoveryCode }
    },

    recoverPlayer(inviteCode, playerName, recoveryCode) {
      const campaign = campaignByInvite.get(inviteCode)
      if (!campaign) return null
      const playerRow = activePlayerByName.get(campaign.id, playerName)
      if (!playerRow || !matchesRecoveryCode(playerRow.recovery_key_hash, recoveryCode)) return { invalid: true }
      const token = randomBytes(32).toString('base64url')
      const nextRecoveryCode = createRecoveryCode()
      updatePlayerCredentials.run(tokenHash(token), recoveryHash(nextRecoveryCode), playerRow.id)
      return {
        campaign: publicCampaign(campaign, roomsByCampaign.all(campaign.id)),
        player: publicPlayer(playerRow, token),
        recoveryCode: nextRecoveryCode,
      }
    },

    resetRecoveryKey(campaignId, playerId) {
      const player = playerForCampaign.get(playerId, campaignId)
      if (!player) return null
      const recoveryCode = createRecoveryCode()
      updateRecoveryKey.run(recoveryHash(recoveryCode), playerId)
      return recoveryCode
    },

    getSession(token) {
      const playerRow = playerByToken.get(tokenHash(token))
      if (!playerRow) return null
      const campaignRow = campaignById.get(playerRow.campaign_id)
      return {
        campaign: publicCampaign(campaignRow, roomsByCampaign.all(campaignRow.id)),
        player: publicPlayer(playerRow, token),
      }
    },

    getCampaignManagement(campaignId) {
      return { players: playersByCampaign.all(campaignId).map((row) => publicPlayer(row)) }
    },

    getCampaignWorld(campaignId) {
      const row = campaignWorld.get(campaignId)
      return publicCampaignWorld(row, row ? { ...campaignWorldCollections(campaignId), consequences: worldConsequences.all(campaignId) } : {})
    },

    getCharacterCreationContext(campaignId, playerId, { includeAllSecrets = false } = {}) {
      const world = this.getCampaignWorld(campaignId)
      const rows = charactersByCampaign.all(campaignId)
      return {
        world: world ? {
          title: world.title,
          premise: world.premise,
          pitch: world.pitch,
          truths: world.truths,
          factions: world.factions.map(({ id, name, goal }) => ({ id, name, goal })),
          locations: world.locations.map(({ id, name, description }) => ({ id, name, description })),
          npcs: world.npcs.map(({ id, name, role }) => ({ id, name, role })),
        } : null,
        characters: rows.map((row) => {
          const canReadPrivate = includeAllSecrets || row.player_id === playerId
          return canReadPrivate ? privateCharacter(row) : { ...publicCharacter(row), revisions: [], aftermathScenes: [] }
        }),
      }
    },

    getCharacterForPlayer(campaignId, playerId, { includeSecret = false } = {}) {
      return publicCharacter(characterByPlayer.get(playerId, campaignId), { includeSecret })
    },

    saveCharacter(campaignId, playerId, character) {
      if (!playerForCampaign.get(playerId, campaignId)) return { outcome: 'not_found' }
      const required = ['name', 'concept', 'appearance', 'drive', 'capability', 'complication', 'possession', 'belief', 'secret', 'factionId', 'factionConnection', 'locationId', 'locationConnection', 'npcId', 'npcConnection']
      if (required.some((field) => typeof character[field] !== 'string' || !character[field].trim())) return { outcome: 'invalid' }
      const collections = campaignWorldCollections(campaignId)
      if (!collections.factions.some((item) => item.id === character.factionId)
        || !collections.locations.some((item) => item.id === character.locationId)
        || !collections.npcs.some((item) => item.id === character.npcId)) return { outcome: 'invalid_connection' }
      if (character.connectedCharacterId) {
        const connected = characterById.get(character.connectedCharacterId, campaignId)
        if (!connected || connected.player_id === playerId || !character.characterConnection?.trim()) return { outcome: 'invalid_connection' }
      }
      const current = characterByPlayer.get(playerId, campaignId)
      const now = new Date().toISOString()
      if (!current) {
        const id = randomUUID()
        database.exec('BEGIN IMMEDIATE')
        try {
          insertCharacter.run(
            id, campaignId, playerId, character.name.trim(), character.concept.trim(), character.appearance.trim(),
            character.drive.trim(), character.capability.trim(), character.complication.trim(), character.possession.trim(),
            character.belief.trim(), character.secret.trim(), character.factionId, character.factionConnection.trim(),
            character.locationId, character.locationConnection.trim(), character.npcId, character.npcConnection.trim(),
            character.connectedCharacterId ?? null, character.characterConnection?.trim() || null,
            character.generatorVersion ?? null, now, now,
          )
          const created = characterById.get(id, campaignId)
          const snapshot = characterSnapshot(created)
          insertCharacterRevision.run(randomUUID(), id, 0, null, 'Character took a seat.', JSON.stringify(Object.keys(snapshot)), JSON.stringify(snapshot), playerId, now)
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        return { outcome: 'created', character: privateCharacter(characterById.get(id, campaignId)) }
      }
      if (character.expectedRevision !== current.revision) return { outcome: 'conflict', character: privateCharacter(current) }
      if (typeof character.reason !== 'string' || !character.reason.trim()) return { outcome: 'reason_required' }
      if (character.sceneId && !resolvedSceneForCharacter.get(current.id, character.sceneId, campaignId)) return { outcome: 'invalid_scene' }
      const before = characterSnapshot(current)
      database.exec('BEGIN IMMEDIATE')
      try {
        const changed = updateCharacter.run(
          character.name.trim(), character.concept.trim(), character.appearance.trim(), character.drive.trim(),
          character.capability.trim(), character.complication.trim(), character.possession.trim(), character.belief.trim(),
          character.secret.trim(), character.factionId, character.factionConnection.trim(), character.locationId,
          character.locationConnection.trim(), character.npcId, character.npcConnection.trim(),
          character.connectedCharacterId ?? null, character.characterConnection?.trim() || null,
          character.generatorVersion ?? current.generator_version, now, current.id, campaignId, playerId, character.expectedRevision,
        ).changes
        if (changed !== 1) throw new Error('character_conflict')
        const updated = characterByPlayer.get(playerId, campaignId)
        const snapshot = characterSnapshot(updated)
        const changedFields = Object.keys(snapshot).filter((field) => JSON.stringify(snapshot[field]) !== JSON.stringify(before[field]))
        if (!changedFields.length) throw new Error('character_unchanged')
        insertCharacterRevision.run(randomUUID(), current.id, updated.revision, character.sceneId ?? null, character.reason.trim(), JSON.stringify(changedFields), JSON.stringify(snapshot), playerId, now)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        if (error.message === 'character_unchanged') return { outcome: 'no_change', character: privateCharacter(current) }
        if (error.message === 'character_conflict') return { outcome: 'conflict', character: privateCharacter(characterByPlayer.get(playerId, campaignId)) }
        throw error
      }
      return { outcome: 'updated', character: privateCharacter(characterByPlayer.get(playerId, campaignId)) }
    },

    getSceneContext(campaignId) {
      const world = this.getCampaignWorld(campaignId)
      const current = activeScene.get(campaignId)
      return {
        openingCrisis: world?.openingCrisis ?? null,
        worldEntities: world ? [
          ...world.factions.map((item) => ({ id: item.id, name: item.name, type: 'faction' })),
          ...world.locations.map((item) => ({ id: item.id, name: item.name, type: 'location' })),
          ...world.npcs.map((item) => ({ id: item.id, name: item.name, type: 'npc' })),
          ...world.hooks.map((item) => ({ id: item.id, name: item.title, type: 'hook' })),
        ] : [],
        characters: charactersByCampaign.all(campaignId).map((row) => ({ id: row.id, name: row.name, playerName: row.player_name, concept: row.concept })),
        activeScene: publicScene(current, current ? sceneCharacters.all(current.id) : []),
        scenes: scenesByCampaign.all(campaignId).map((row) => publicScene(row, sceneCharacters.all(row.id))),
        worldConsequences: activeWorldConsequences.all(campaignId).map(publicWorldConsequence),
      }
    },

    startScene(campaignId, playerId, { title, framing, stakes, question, characterIds }) {
      if (activeScene.get(campaignId)) return { outcome: 'active', context: this.getSceneContext(campaignId) }
      const room = inCharacterRoom.get(campaignId)
      const available = charactersByCampaign.all(campaignId)
      const chosen = available.filter((character) => characterIds.includes(character.id))
      if (!room || !this.getCampaignWorld(campaignId) || !chosen.length || chosen.length !== new Set(characterIds).size) return { outcome: 'invalid' }
      const id = randomUUID()
      const messageId = randomUUID()
      const clientMessageId = `scene:${id}:start`
      const now = new Date().toISOString()
      const scene = { id, title, framing, stakes, question, characters: chosen.map((character) => ({ id: character.id, name: character.name, playerName: character.player_name })) }
      database.exec('BEGIN IMMEDIATE')
      try {
        insertScene.run(id, campaignId, title, framing, stakes, question, playerId, now)
        for (const character of chosen) insertSceneCharacter.run(id, character.id)
        insertMessage.run(messageId, room.id, playerId, clientMessageId, framing, null, 'scene_start', JSON.stringify(scene), now)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'started', roomId: room.id, message: publicMessage(messageByClientId.get(playerId, clientMessageId)), context: this.getSceneContext(campaignId) }
    },

    resolveScene(campaignId, playerId, sceneId, outcome, consequences = []) {
      const current = activeScene.get(campaignId)
      if (!current || current.id !== sceneId) return { outcome: 'not_found' }
      const consequenceTargets = consequences.map((item) => `${item.entityType}:${item.entityId}`)
      if (consequences.length > 3 || consequenceTargets.length !== new Set(consequenceTargets).size || consequences.some((item) => !item.afterState?.trim() || !item.pressure?.trim())) return { outcome: 'invalid_consequence' }
      const world = this.getCampaignWorld(campaignId)
      const collections = { faction: world?.factions ?? [], location: world?.locations ?? [], npc: world?.npcs ?? [], hook: world?.hooks ?? [] }
      const preparedConsequences = consequences.map((consequence) => {
        const entity = collections[consequence.entityType]?.find((item) => item.id === consequence.entityId)
        if (!entity) return null
        const previous = activeWorldConsequenceForEntity.get(campaignId, consequence.entityType, consequence.entityId)
        const baseline = consequence.entityType === 'faction' ? `${entity.goal} ${entity.opposition}` : consequence.entityType === 'location' ? `${entity.description} ${entity.danger}` : consequence.entityType === 'npc' ? `${entity.role} ${entity.want} ${entity.leverage}` : entity.situation
        return { ...consequence, entityName: entity.name ?? entity.title, beforeState: previous?.after_state ?? baseline, previousId: previous?.id ?? null }
      })
      if (preparedConsequences.some((item) => !item)) return { outcome: 'invalid_consequence' }
      const room = inCharacterRoom.get(campaignId)
      const messageId = randomUUID()
      const clientMessageId = `scene:${sceneId}:end`
      const now = new Date().toISOString()
      const metadata = { id: sceneId, title: current.title, outcome }
      database.exec('BEGIN IMMEDIATE')
      try {
        if (resolveScene.run(outcome, playerId, now, sceneId, campaignId).changes !== 1) throw new Error('scene_conflict')
        for (const consequence of preparedConsequences) {
          if (consequence.previousId) resolveWorldConsequence.run(sceneId, outcome, playerId, now, consequence.previousId)
          insertWorldConsequence.run(randomUUID(), campaignId, sceneId, consequence.entityType, consequence.entityId, consequence.entityName, consequence.beforeState, consequence.afterState, consequence.pressure, playerId, now)
        }
        insertMessage.run(messageId, room.id, playerId, clientMessageId, outcome, null, 'scene_end', JSON.stringify(metadata), now)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'resolved', roomId: room.id, message: publicMessage(messageByClientId.get(playerId, clientMessageId)), context: this.getSceneContext(campaignId) }
    },

    createCampaignWorld(campaignId, playerId, world) {
      if (!campaignById.get(campaignId) || campaignWorld.get(campaignId)) return { outcome: 'conflict', world: this.getCampaignWorld(campaignId) }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertCampaignWorld.run(
          campaignId, world.title, world.premise, world.pitch, world.openingCrisis.title,
          world.openingCrisis.situation, world.openingCrisis.stakes, world.generatorVersion,
          playerId, playerId, now, now,
        )
        replaceCampaignWorldCollections(campaignId, world)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'created', world: this.getCampaignWorld(campaignId) }
    },

    updateCampaignWorld(campaignId, playerId, world) {
      const current = campaignWorld.get(campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.revision !== world.expectedRevision) return { outcome: 'conflict', world: this.getCampaignWorld(campaignId) }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateCampaignWorld.run(
          world.title, world.premise, world.pitch, world.openingCrisis.title,
          world.openingCrisis.situation, world.openingCrisis.stakes, playerId, now,
          campaignId, world.expectedRevision,
        ).changes !== 1) throw new Error('campaign_world_conflict')
        replaceCampaignWorldCollections(campaignId, world)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'updated', world: this.getCampaignWorld(campaignId) }
    },

    listCampaignMembers(campaignId) {
      return playersByCampaign.all(campaignId).map((row) => publicPlayer(row))
    },

    setPlayerKnowledgeRole(campaignId, playerId, knowledgeRole) {
      const player = playerForCampaign.get(playerId, campaignId)
      if (!player) return { outcome: 'not_found' }
      if (player.role === 'owner') return { outcome: 'owner' }
      updateKnowledgeRole.run(knowledgeRole, playerId, campaignId)
      return { outcome: 'updated', management: this.getCampaignManagement(campaignId) }
    },

    rotateInvitation(campaignId) {
      const inviteCode = randomBytes(5).toString('hex')
      updateInvitation.run(inviteCode, campaignId)
      return publicCampaign(campaignById.get(campaignId), roomsByCampaign.all(campaignId))
    },

    removePlayer(campaignId, playerId) {
      const player = playerForCampaign.get(playerId, campaignId)
      if (!player) return { outcome: 'not_found' }
      if (player.role === 'owner') return { outcome: 'owner' }
      removePlayer.run(new Date().toISOString(), playerId)
      return { outcome: 'removed', management: this.getCampaignManagement(campaignId) }
    },

    createRoom(campaignId, name, description) {
      const baseSlug = roomSlug(name)
      let slug = baseSlug
      let suffix = 2
      while (roomSlugExists.get(campaignId, slug)) slug = `${baseSlug}-${suffix++}`
      insertRoom.run(randomUUID(), campaignId, slug, name, description, nextRoomPosition.get(campaignId).position)
      return publicCampaign(campaignById.get(campaignId), roomsByCampaign.all(campaignId))
    },

    updateRoom(campaignId, roomId, name, description) {
      if (!roomForCampaign.get(roomId, campaignId)) return null
      updateRoom.run(name, description, roomId, campaignId)
      return publicCampaign(campaignById.get(campaignId), roomsByCampaign.all(campaignId))
    },

    reorderRooms(campaignId, roomIds) {
      const currentIds = roomsByCampaign.all(campaignId).map((room) => room.id)
      if (roomIds.length !== currentIds.length || new Set(roomIds).size !== roomIds.length || roomIds.some((id) => !currentIds.includes(id))) return null
      database.exec('BEGIN IMMEDIATE')
      try {
        roomIds.forEach((roomId, position) => updateRoomPosition.run(position, roomId, campaignId))
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return publicCampaign(campaignById.get(campaignId), roomsByCampaign.all(campaignId))
    },

    archiveRoom(campaignId, roomId) {
      if (!roomForCampaign.get(roomId, campaignId)) return { outcome: 'not_found' }
      if (roomsByCampaign.all(campaignId).length <= 1) return { outcome: 'last_room' }
      archiveRoom.run(new Date().toISOString(), roomId, campaignId)
      return { outcome: 'archived', campaign: publicCampaign(campaignById.get(campaignId), roomsByCampaign.all(campaignId)) }
    },

    getRoom(roomId, campaignId) {
      return roomForCampaign.get(roomId, campaignId) ?? null
    },

    addMessage({ roomId, playerId, clientMessageId, text }) {
      const message = {
        id: randomUUID(),
        clientMessageId,
        senderId: playerId,
        text,
        sentAt: new Date().toISOString(),
      }
      const characterName = messageCharacter.get(playerId, roomId)?.character_name ?? null
      const inserted = insertMessage.run(message.id, roomId, playerId, clientMessageId, text, characterName, 'chat', null, message.sentAt).changes === 1
      const stored = messageByClientId.get(playerId, clientMessageId)
      return { message: publicMessage(stored), inserted }
    },

    listMessages(roomId, { before, limit = 100 } = {}) {
      const rows = before
        ? olderMessagesForRoom.all(roomId, before, limit + 1)
        : latestMessagesForRoom.all(roomId, limit + 1)
      const hasMore = rows.length > limit
      return { messages: rows.slice(hasMore ? 1 : 0).map(publicMessage), hasMore }
    },

    markRoomRead(playerId, roomId) {
      upsertRoomRead.run(playerId, roomId, newestRoomSequence.get(roomId).sequence, new Date().toISOString())
    },

    getUnreadRooms(campaignId, playerId) {
      return Object.fromEntries(unreadRoomsForPlayer.all(playerId, playerId, campaignId)
        .filter((row) => row.unread > 0)
        .map((row) => [row.room_id, row.unread]))
    },

    searchMessages(campaignId, query) {
      return searchMessagesForCampaign.all(campaignId, query).map((row) => ({
        id: row.id,
        roomId: row.room_id,
        roomName: row.room_name,
        senderId: row.player_id,
        senderName: row.sender_name,
        text: row.text,
        sentAt: row.sent_at,
        sequence: row.sequence,
      }))
    },

    listRecentCampaignMessages(campaignId, limit = 100) {
      return recentMessagesForCampaign.all(campaignId, limit).map((row) => ({
        id: row.id,
        roomId: row.room_id,
        roomName: row.room_name,
        senderName: row.sender_name,
        text: row.text,
        sentAt: row.sent_at,
        sequence: row.sequence,
      }))
    },

    listUnscannedCampaignMessages(campaignId, limit = 100) {
      const state = canonScanState.get(campaignId)
      return messagesAfterSequenceForCampaign.all(campaignId, state?.last_scanned_sequence ?? 0, limit).map((row) => ({
        id: row.id,
        roomId: row.room_id,
        roomName: row.room_name,
        senderName: row.sender_name,
        text: row.text,
        sentAt: row.sent_at,
        sequence: row.sequence,
      }))
    },

    getCanonCoverage(campaignId) {
      const state = canonScanState.get(campaignId)
      const lastScannedSequence = state?.last_scanned_sequence ?? 0
      const coverage = campaignMessageCoverage.get(lastScannedSequence, campaignId)
      return {
        lastScannedSequence,
        latestSequence: coverage.latest_sequence,
        unscannedCount: coverage.unscanned_count,
        lastScannedAt: state?.updated_at ?? null,
      }
    },

    markCanonScanned(campaignId, playerId, throughSequence) {
      const current = canonScanState.get(campaignId)?.last_scanned_sequence ?? 0
      upsertCanonScanState.run(campaignId, Math.max(current, throughSequence), playerId, new Date().toISOString())
      return this.getCanonCoverage(campaignId)
    },

    getCampaignNote(campaignId) {
      const row = campaignNote.get(campaignId)
      return row ? {
        body: row.body,
        revision: row.revision,
        updatedAt: row.updated_at,
        updatedByName: row.updated_by_name,
      } : null
    },

    updateCampaignNote(campaignId, playerId, body, expectedRevision) {
      const current = campaignNote.get(campaignId)
      if (!current || current.revision !== expectedRevision) return { conflict: true, note: this.getCampaignNote(campaignId) }
      updateCampaignNote.run(body, current.revision + 1, playerId, new Date().toISOString(), campaignId)
      return { conflict: false, note: this.getCampaignNote(campaignId) }
    },

    listCampaignSessions(campaignId) {
      const coverage = this.getCanonCoverage(campaignId)
      const present = (session) => ({
        id: session.id,
        title: session.title,
        status: session.status,
        startSequence: session.start_sequence,
        endSequence: session.end_sequence,
        messageCount: session.message_count ?? campaignSessionMessageCount.get(campaignId, session.start_sequence, session.end_sequence).message_count,
        participants: campaignSessionParticipants.all(campaignId, session.start_sequence, session.end_sequence),
        canonCoverage: coverage.lastScannedSequence >= session.end_sequence ? 'reviewed'
          : coverage.lastScannedSequence >= session.start_sequence ? 'partial' : 'unreviewed',
        closedAt: session.closed_at ?? null,
        closedByName: session.closed_by_name ?? null,
      })
      const current = currentCampaignSessionBounds.get(campaignId, campaignId)
      const sessions = closedCampaignSessions.all(campaignId).map((row) => present({ ...row, status: 'closed' }))
      if (current.message_count) sessions.unshift(present({ id: 'current', title: 'Current session', status: 'open', ...current }))
      return sessions
    },

    closeCampaignSession(campaignId, playerId, title) {
      const bounds = currentCampaignSessionBounds.get(campaignId, campaignId)
      if (!bounds.message_count) return { outcome: 'empty', sessions: this.listCampaignSessions(campaignId) }
      insertCampaignSession.run(randomUUID(), campaignId, title, bounds.start_sequence, bounds.end_sequence, playerId, new Date().toISOString())
      return { outcome: 'closed', sessions: this.listCampaignSessions(campaignId) }
    },

    getCampaignSessionMessages(campaignId, sessionId = null, limit = 250) {
      const sessions = this.listCampaignSessions(campaignId)
      const session = sessionId ? sessions.find((item) => item.id === sessionId) : sessions[0]
      if (!session) return null
      const rows = campaignSessionMessages.all(campaignId, session.startSequence, session.endSequence, limit + 1)
      return {
        session,
        truncated: rows.length > limit,
        messages: rows.slice(0, limit).map((row) => ({
          id: row.id, roomId: row.room_id, roomName: row.room_name, senderName: row.sender_name,
          text: row.text, sentAt: row.sent_at, sequence: row.sequence,
        })),
      }
    },

    getCanonConstitution(campaignId) {
      const row = latestCanonConstitution.get(campaignId)
      return row ? publicCanonConstitution(row) : null
    },

    updateCanonConstitution(campaignId, playerId, constitution, expectedRevision) {
      const current = latestCanonConstitution.get(campaignId)
      if (!current || current.revision !== expectedRevision) return { conflict: true, constitution: current ? publicCanonConstitution(current) : null }
      insertCanonConstitutionRevision.run(
        campaignId, expectedRevision + 1, constitution.canonThreshold, constitution.playerDeclarations,
        constitution.oocPolicy, constitution.correctionPolicy, constitution.defaultVisibility,
        constitution.guidance, playerId, new Date().toISOString(),
      )
      return { conflict: false, constitution: this.getCanonConstitution(campaignId) }
    },

    createCanonProposal({ campaignId, playerId = null, kind, title, claim, visibility, confidence = null, extractorVersion, sources }) {
      if (!Array.isArray(sources) || sources.length === 0) return { outcome: 'sources_required' }
      const resolvedSources = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (resolvedSources.some((source) => !source.row)) return { outcome: 'invalid_source' }
      const extractionKey = createHash('sha256').update(JSON.stringify([
        extractorVersion,
        kind,
        title,
        claim,
        visibility,
        sources.map((source) => source.messageId).sort(),
      ])).digest('hex')
      const semanticMatch = findNearDuplicateCanon(
        { kind, title, claim },
        canonProposalCandidates.all(campaignId, kind),
      )
      const exactMatch = semanticMatch ? null : canonProposalByExtractionKey.get(campaignId, extractionKey)
      const match = semanticMatch ?? (exactMatch ? { item: exactMatch, similarity: 1 } : null)
      if (match) {
        const existingSources = canonSourcesForProposal.all(match.item.id)
        const existingMessageIds = new Set(existingSources.map((source) => source.message_id))
        const additions = match.item.status === 'proposed'
          ? resolvedSources.filter((source) => !existingMessageIds.has(source.messageId)).slice(0, Math.max(0, 10 - existingSources.length))
          : []
        const outcome = match.item.status !== 'proposed' ? 'suppressed' : additions.length ? 'merged' : 'existing'
        database.exec('BEGIN IMMEDIATE')
        try {
          for (const source of additions) insertCanonProposalSourceIfNew.run(match.item.id, source.messageId, source.excerpt ?? null)
          insertCanonProposalMatch.run(randomUUID(), campaignId, match.item.id, extractorVersion, outcome, match.item.status, match.similarity, new Date().toISOString())
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        const existing = canonProposalById.get(match.item.id, campaignId)
        return {
          outcome,
          matchedStatus: match.item.status,
          similarity: match.similarity,
          proposal: publicCanonProposal(existing, canonSourcesForProposal.all(match.item.id)),
        }
      }
      const proposalId = randomUUID()
      const createdAt = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertCanonProposal.run(proposalId, campaignId, kind, title, claim, visibility, confidence, extractorVersion, extractionKey, playerId, createdAt)
        for (const source of resolvedSources) insertCanonProposalSource.run(proposalId, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      const row = canonProposalById.get(proposalId, campaignId)
      return { outcome: 'created', proposal: publicCanonProposal(row, canonSourcesForProposal.all(proposalId)) }
    },

    getCanonProposalMatchMetrics(campaignId = null) {
      return canonProposalMatchMetrics.all(campaignId, campaignId).map((row) => ({
        extractorVersion: row.extractor_version,
        total: row.total,
        existing: row.existing,
        merged: row.merged,
        suppressed: row.suppressed,
      }))
    },

    getCanonProposal(campaignId, proposalId) {
      const row = canonProposalById.get(proposalId, campaignId)
      return row ? publicCanonProposal(row, canonSourcesForProposal.all(proposalId)) : null
    },

    listCanonProposals(campaignId, { includeGmOnly = false } = {}) {
      return canonProposalsForCampaign.all(campaignId)
        .filter((row) => includeGmOnly || row.visibility === 'campaign')
        .map((row) => publicCanonProposal(row, canonSourcesForProposal.all(row.id)))
    },

    decideCanonProposal(campaignId, playerId, proposalId, { action, reason = null, title = null, claim = null, visibility = null, audiencePlayerIds = [] }) {
      const proposal = canonProposalById.get(proposalId, campaignId)
      if (!proposal) return { outcome: 'not_found' }
      if (proposal.status !== 'proposed') return { outcome: 'already_decided', proposal: this.getCanonProposal(campaignId, proposalId) }
      const nextStatus = action === 'accept' || action === 'edit_accept' ? 'accepted' : action === 'dispute' ? 'disputed' : 'rejected'
      const acceptedTitle = action === 'edit_accept' ? title : proposal.title
      const acceptedClaim = action === 'edit_accept' ? claim : proposal.claim
      const acceptedVisibility = nextStatus === 'accepted' ? visibility === 'characters' ? 'gm_only' : visibility ?? proposal.visibility : null
      const audiences = visibility === 'characters' ? [...new Set(audiencePlayerIds)] : []
      if (audiences.some((audienceId) => !playerForCampaign.get(audienceId, campaignId))) return { outcome: 'invalid_audience' }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateCanonProposalStatus.run(nextStatus, proposalId, campaignId).changes !== 1) throw new Error('canon_proposal_conflict')
        insertCanonDecision.run(randomUUID(), proposalId, playerId, action, reason, acceptedTitle, acceptedClaim, acceptedVisibility, now)
        if (nextStatus === 'accepted') {
          const entryId = randomUUID()
          const revisionId = randomUUID()
          insertCanonEntry.run(entryId, proposalId, campaignId, proposal.kind, acceptedTitle, acceptedClaim, acceptedVisibility, playerId, now, now)
          insertCanonEntryRevision.run(revisionId, entryId, 0, 'accepted', acceptedTitle, acceptedClaim, acceptedVisibility, reason, playerId, now)
          for (const audienceId of audiences) {
            insertCanonEntryAudience.run(entryId, audienceId)
            insertCanonRevisionAudience.run(revisionId, audienceId)
          }
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: nextStatus, proposal: this.getCanonProposal(campaignId, proposalId) }
    },

    listCanonDecisionExamples(campaignId, limit = 20) {
      return canonDecisionExamples.all(campaignId, limit).reverse().map((row) => ({
        proposal: { kind: row.kind, title: row.title, claim: row.claim },
        action: row.action,
        reason: row.reason,
        accepted: row.accepted_title ? {
          title: row.accepted_title,
          claim: row.accepted_claim,
          visibility: row.accepted_visibility,
        } : null,
        extractorVersion: row.extractor_version,
        decidedAt: row.created_at,
      }))
    },

    exportAiFeedback(campaignId = null) {
      const canon = canonFeedbackForExport.all(campaignId, campaignId).map((row) => ({
        fixtureId: `canon:${row.proposal_id}`,
        campaignRef: row.campaign_id,
        generatorVersion: row.extractor_version,
        generatedAt: row.created_at,
        proposal: {
          kind: row.kind,
          title: row.title,
          claim: row.claim,
          visibility: row.visibility,
          confidence: row.confidence,
          sources: canonSourcesForProposal.all(row.proposal_id).map((source) => ({
            messageId: source.message_id,
            roomId: source.room_id,
            text: source.text,
            excerpt: source.excerpt,
            sentAt: source.sent_at,
            sequence: source.sequence,
          })),
        },
        decision: {
          action: row.action,
          reason: row.reason,
          accepted: row.accepted_title ? {
            title: row.accepted_title,
            claim: row.accepted_claim,
            visibility: row.accepted_visibility,
          } : null,
          decidedAt: row.decided_at,
        },
      }))
      const continuity = continuityFeedbackForExport.all(campaignId, campaignId).map((row) => ({
        fixtureId: `continuity:${row.thread_id}`,
        campaignRef: row.campaign_id,
        generatorVersion: row.generator_version,
        generatedAt: row.created_at,
        thread: {
          title: row.title,
          summary: row.summary,
          whyItMatters: row.why_it_matters,
          confidence: row.confidence,
          sources: continuitySourcesForThread.all(row.thread_id).map((source) => ({
            messageId: source.message_id,
            roomId: source.room_id,
            text: source.text,
            excerpt: source.excerpt,
            sentAt: source.sent_at,
            sequence: source.sequence,
          })),
        },
        feedback: { rating: row.rating, ratedAt: row.rated_at },
      }))
      const knowledge = knowledgeFeedbackForCampaign.all(campaignId).map((row) => ({
        fixtureId: `knowledge:${row.answer_id}`,
        generatorVersion: row.generator_version,
        generatedAt: row.created_at,
        question: row.question,
        answer: row.answer,
        citationIds: knowledgeAnswerSources.all(row.answer_id).map((source) => source.canon_entry_id),
        feedback: { rating: row.rating, ratedAt: row.rated_at },
      }))
      const houseRules = houseRuleProposalsForExport.all(campaignId, campaignId).map((row) => ({
        fixtureId: `house-rule:${row.id}`,
        campaignRef: row.campaign_id,
        generatorVersion: row.generator_version,
        generatedAt: row.created_at,
        proposal: {
          title: row.title, sourceRule: row.source_rule, interpretation: row.interpretation, ruling: row.ruling,
          sources: houseRuleProposalSources.all(row.id).map((source) => ({ messageId: source.message_id, roomId: source.room_id, text: source.text, excerpt: source.excerpt, sentAt: source.sent_at, sequence: source.sequence })),
        },
        decision: {
          action: row.decision_action, reason: row.decision_reason,
          accepted: row.decision_action === 'reject' ? null : { title: row.decided_title, sourceRule: row.decided_source_rule, interpretation: row.decided_interpretation, ruling: row.decided_ruling },
          decidedAt: row.decided_at,
        },
      }))
      return { canon, continuity, knowledge, houseRules, deduplication: this.getCanonProposalMatchMetrics(campaignId) }
    },

    listContinuityFeedbackExamples(campaignId, limit = 20) {
      return continuityFeedbackForExport.all(campaignId, campaignId).slice(-limit).map((row) => ({
        thread: { title: row.title, summary: row.summary, whyItMatters: row.why_it_matters },
        rating: row.rating,
        generatorVersion: row.generator_version,
      }))
    },

    listCanonEntries(campaignId, { includeGmOnly = false, viewerPlayerId = null, redactForViewer = !includeGmOnly } = {}) {
      const sessions = redactForViewer && viewerPlayerId ? this.listCampaignSessions(campaignId) : []
      const witnessed = (sequence) => sessions.some((session) => sequence >= session.startSequence
        && sequence <= session.endSequence
        && session.participants.some((participant) => participant.id === viewerPlayerId))
      return canonEntriesForCampaign.all(campaignId)
        .map((row) => ({ row, audiences: canonAudiencesForEntry.all(row.id) }))
        .filter(({ row, audiences }) => includeGmOnly || row.visibility === 'campaign' || audiences.some((audience) => audience.id === viewerPlayerId))
        .map(({ row, audiences }) => {
          const sources = canonSourcesForEntry.all(row.id)
          const targetedForViewer = redactForViewer && audiences.some((audience) => audience.id === viewerPlayerId)
          if (!targetedForViewer) return publicCanonEntry(row, sources, audiences, includeGmOnly ? 'gm_review' : 'full')
          const witnessedSources = sources.filter((source) => witnessed(source.sequence))
          return publicCanonEntry(row, witnessedSources, audiences, witnessedSources.length ? 'witnessed' : 'gm_confirmed')
        })
    },

    getCanonEntry(campaignId, entryId, { includeGmOnly = false, viewerPlayerId = null, redactForViewer = !includeGmOnly } = {}) {
      const row = canonEntryById.get(entryId, campaignId)
      const audiences = row ? canonAudiencesForEntry.all(entryId) : []
      if (!row || (!includeGmOnly && row.visibility !== 'campaign' && !audiences.some((audience) => audience.id === viewerPlayerId))) return null
      const sources = canonSourcesForEntry.all(entryId)
      const targetedForViewer = redactForViewer && audiences.some((audience) => audience.id === viewerPlayerId)
      if (!targetedForViewer) return publicCanonEntry(row, sources, audiences, includeGmOnly ? 'gm_review' : 'full')
      const sessions = this.listCampaignSessions(campaignId)
      const witnessedSources = sources.filter((source) => sessions.some((session) => source.sequence >= session.startSequence
        && source.sequence <= session.endSequence
        && session.participants.some((participant) => participant.id === viewerPlayerId)))
      return publicCanonEntry(row, witnessedSources, audiences, witnessedSources.length ? 'witnessed' : 'gm_confirmed')
    },

    reviseCanonEntry(campaignId, playerId, entryId, { action, title, claim, visibility, audiencePlayerIds = [], reason = null, expectedRevision }) {
      const current = canonEntryById.get(entryId, campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.status !== 'active' || current.revision !== expectedRevision) return { outcome: 'conflict', entry: this.getCanonEntry(campaignId, entryId, { includeGmOnly: true }) }
      const now = new Date().toISOString()
      const storedVisibility = visibility === 'characters' ? 'gm_only' : visibility
      const audiences = visibility === 'characters' ? [...new Set(audiencePlayerIds)] : []
      if (audiences.some((audienceId) => !playerForCampaign.get(audienceId, campaignId))) return { outcome: 'invalid_audience' }
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateCanonEntry.run(title, claim, storedVisibility, now, entryId, campaignId, expectedRevision).changes !== 1) throw new Error('canon_entry_conflict')
        const revisionId = randomUUID()
        insertCanonEntryRevision.run(revisionId, entryId, expectedRevision + 1, action, title, claim, storedVisibility, reason, playerId, now)
        deleteCanonEntryAudiences.run(entryId)
        for (const audienceId of audiences) {
          insertCanonEntryAudience.run(entryId, audienceId)
          insertCanonRevisionAudience.run(revisionId, audienceId)
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: action, entry: this.getCanonEntry(campaignId, entryId, { includeGmOnly: true }) }
    },

    retractCanonEntry(campaignId, playerId, entryId, { reason, expectedRevision }) {
      const current = canonEntryById.get(entryId, campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.status !== 'active' || current.revision !== expectedRevision) return { outcome: 'conflict', entry: this.getCanonEntry(campaignId, entryId, { includeGmOnly: true }) }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (retractCanonEntry.run(now, entryId, campaignId, expectedRevision).changes !== 1) throw new Error('canon_entry_conflict')
        const revisionId = randomUUID()
        insertCanonEntryRevision.run(revisionId, entryId, expectedRevision + 1, 'retracted', current.title, current.claim, current.visibility, reason, playerId, now)
        for (const audience of canonAudiencesForEntry.all(entryId)) insertCanonRevisionAudience.run(revisionId, audience.id)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'retracted', entry: this.getCanonEntry(campaignId, entryId, { includeGmOnly: true }) }
    },

    listCanonEntryHistory(campaignId, entryId, { includeGmOnly = false } = {}) {
      const entry = this.getCanonEntry(campaignId, entryId, { includeGmOnly })
      if (!entry) return null
      return { entry, revisions: canonRevisionsForEntry.all(entryId).map((revision) => publicCanonRevision(revision, canonAudiencesForRevision.all(revision.id))) }
    },

    getCharacterKnowledge(campaignId, playerId) {
      const player = playerForCampaign.get(playerId, campaignId)
      if (!player) return null
      return {
        player: publicPlayer(player),
        entries: this.listCanonEntries(campaignId, { viewerPlayerId: playerId, redactForViewer: true }),
        sessions: this.listCampaignSessions(campaignId).filter((session) => session.participants.some((participant) => participant.id === playerId)),
      }
    },

    createContradictionReport({ campaignId, playerId, generatorVersion, session = null, findings }) {
      const resolved = findings.map((finding) => ({
        ...finding,
        canon: canonEntryById.get(finding.canonEntryId, campaignId),
        sources: finding.sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) })),
      }))
      if (resolved.some((finding) => !finding.canon || finding.sources.some((source) => !source.row))) return { outcome: 'invalid_source' }
      const reportId = randomUUID()
      const createdAt = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertContradictionReport.run(
          reportId, campaignId, generatorVersion, session?.id ?? null, session?.title ?? null,
          session?.status ?? null, session?.startSequence ?? null, session?.endSequence ?? null,
          playerId, createdAt,
        )
        resolved.forEach((finding, position) => {
          const findingId = randomUUID()
          insertContradictionFinding.run(findingId, reportId, position, finding.canonEntryId, finding.canon.title, finding.canon.claim, finding.title, finding.explanation, finding.confidence)
          for (const source of finding.sources) insertContradictionSource.run(findingId, source.messageId, source.excerpt ?? null)
        })
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'created', report: this.getLatestContradictionReport(campaignId) }
    },

    getLatestContradictionReport(campaignId) {
      const row = latestContradictionReport.get(campaignId)
      if (!row) return null
      const findings = contradictionFindingsForReport.all(row.id).map((finding) => ({
        id: finding.id,
        canonEntryId: finding.canon_entry_id,
        canonTitle: finding.canon_title,
        canonClaim: finding.canon_claim,
        title: finding.title,
        explanation: finding.explanation,
        confidence: finding.confidence,
        sources: contradictionSourcesForFinding.all(finding.id).map((source) => ({
          messageId: source.message_id,
          roomId: source.room_id,
          roomName: source.room_name,
          senderName: source.sender_name,
          text: source.text,
          excerpt: source.excerpt,
          sentAt: source.sent_at,
          sequence: source.sequence,
        })),
      }))
      return publicContradictionReport(row, findings)
    },

    createContinuityBrief({ campaignId, playerId, generatorVersion, session = null, threads, preparationRunId = null }) {
      if (preparationRunId && continuityBriefForPreparationRun.get(preparationRunId)) {
        return { outcome: 'existing', brief: { id: continuityBriefForPreparationRun.get(preparationRunId).id } }
      }
      const resolved = threads.map((thread) => ({
        ...thread,
        sources: thread.sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) })),
      }))
      if (resolved.some((thread) => thread.sources.some((source) => !source.row))) return { outcome: 'invalid_source' }
      const briefId = randomUUID()
      const createdAt = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertContinuityBrief.run(
          briefId, campaignId, preparationRunId, generatorVersion, session?.id ?? null, session?.title ?? null,
          session?.status ?? null, session?.startSequence ?? null, session?.endSequence ?? null,
          playerId, createdAt,
        )
        resolved.forEach((thread, position) => {
          const threadId = randomUUID()
          insertContinuityThread.run(threadId, briefId, position, thread.title, thread.summary, thread.whyItMatters, thread.confidence)
          for (const source of thread.sources) insertContinuitySource.run(threadId, source.messageId, source.excerpt ?? null)
        })
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'created', brief: this.getLatestContinuityBrief(campaignId) }
    },

    getLatestContinuityBrief(campaignId) {
      const row = latestContinuityBrief.get(campaignId)
      if (!row) return null
      const threads = continuityThreadsForBrief.all(row.id).map((thread) => {
        const feedback = continuityFeedbackForThread.get(thread.id)
        const lifecycleHistory = continuityTransitionsForThread.all(thread.id).map((transition) => ({
          status: transition.status,
          reason: transition.reason,
          createdAt: transition.created_at,
          createdByName: transition.created_by_name,
        }))
        return {
          id: thread.id,
          title: thread.title,
          summary: thread.summary,
          whyItMatters: thread.why_it_matters,
          confidence: thread.confidence,
          feedback: feedback ? { rating: feedback.rating, createdAt: feedback.created_at } : null,
          lifecycle: lifecycleHistory[0] ?? { status: 'open', reason: null, createdAt: row.created_at, createdByName: row.created_by_name },
          lifecycleHistory,
          sources: continuitySourcesForThread.all(thread.id).map((source) => ({
            messageId: source.message_id,
            roomId: source.room_id,
            roomName: source.room_name,
            senderName: source.sender_name,
            text: source.text,
            excerpt: source.excerpt,
            sentAt: source.sent_at,
            sequence: source.sequence,
          })),
        }
      })
      return publicContinuityBrief(row, threads)
    },

    recordContinuityFeedback(campaignId, playerId, threadId, rating) {
      if (!continuityThreadForCampaign.get(threadId, campaignId)) return null
      insertContinuityFeedback.run(randomUUID(), threadId, playerId, rating, new Date().toISOString())
      return this.getLatestContinuityBrief(campaignId)
    },

    transitionContinuityThread(campaignId, playerId, threadId, status, reason) {
      if (!continuityThreadForCampaign.get(threadId, campaignId)) return null
      insertContinuityTransition.run(randomUUID(), threadId, status, reason, playerId, new Date().toISOString())
      return this.getLatestContinuityBrief(campaignId)
    },

    createSessionRecap({ campaignId, playerId, generatorVersion, session, publicSummary, gmNotes, sources, preparationRunId = null }) {
      if (preparationRunId && sessionRecapForPreparationRun.get(preparationRunId)) {
        return { outcome: 'existing', recap: { id: sessionRecapForPreparationRun.get(preparationRunId).id } }
      }
      const resolved = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (resolved.some((source) => !source.row)) return { outcome: 'invalid_source' }
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertSessionRecap.run(id, campaignId, preparationRunId, generatorVersion, publicSummary, gmNotes, session.id, session.title, session.status, session.startSequence, session.endSequence, playerId, createdAt, playerId, createdAt)
        insertSessionRecapRevision.run(randomUUID(), id, 0, publicSummary, gmNotes, playerId, createdAt)
        for (const source of resolved) insertSessionRecapSource.run(id, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'created', recap: this.getLatestSessionRecap(campaignId, { includeDrafts: true, includeGmNotes: true }) }
    },

    getLatestSessionRecap(campaignId, { includeDrafts = false, includeGmNotes = false } = {}) {
      const row = (includeDrafts ? latestSessionRecap : latestPublishedSessionRecap).get(campaignId)
      if (!row) return null
      const sources = sessionRecapSources.all(row.id).map((source) => ({
        messageId: source.message_id, roomId: source.room_id, roomName: source.room_name,
        senderName: source.sender_name, text: source.text, excerpt: source.excerpt,
        sentAt: source.sent_at, sequence: source.sequence,
      }))
      return publicSessionRecap(row, sources, { includeGmNotes })
    },

    publishSessionRecap(campaignId, playerId, recapId) {
      const current = sessionRecapById.get(recapId, campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.status === 'published') return { outcome: 'already_published', recap: this.getLatestSessionRecap(campaignId, { includeDrafts: true, includeGmNotes: true }) }
      publishSessionRecap.run(playerId, new Date().toISOString(), recapId, campaignId)
      return { outcome: 'published', recap: this.getLatestSessionRecap(campaignId, { includeDrafts: true, includeGmNotes: true }) }
    },

    reviseSessionRecap(campaignId, playerId, recapId, { publicSummary, gmNotes, expectedRevision }) {
      const current = sessionRecapById.get(recapId, campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.status !== 'draft') return { outcome: 'published' }
      if (current.revision !== expectedRevision) return { outcome: 'conflict', recap: this.getLatestSessionRecap(campaignId, { includeDrafts: true, includeGmNotes: true }) }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateSessionRecap.run(publicSummary, gmNotes, playerId, now, recapId, campaignId, expectedRevision).changes !== 1) throw new Error('session_recap_conflict')
        insertSessionRecapRevision.run(randomUUID(), recapId, expectedRevision + 1, publicSummary, gmNotes, playerId, now)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'revised', recap: this.getLatestSessionRecap(campaignId, { includeDrafts: true, includeGmNotes: true }) }
    },

    listSessionRecapHistory(campaignId, recapId) {
      if (!sessionRecapById.get(recapId, campaignId)) return null
      return sessionRecapRevisions.all(recapId).map((revision) => ({
        id: revision.id, revision: revision.revision, publicSummary: revision.public_summary,
        gmNotes: revision.gm_notes, createdAt: revision.created_at, createdByName: revision.created_by_name,
      }))
    },

    recordAiEvaluationRun({ campaignId = null, suite, model, generatorVersion, passed, total, notes = null }) {
      const run = { id: randomUUID(), campaignId, suite, model, generatorVersion, passed, total, notes, createdAt: new Date().toISOString() }
      insertAiEvaluationRun.run(run.id, campaignId, suite, model, generatorVersion, passed, total, notes, run.createdAt)
      return run
    },

    listAiEvaluationRuns(campaignId = null, limit = 50) {
      return aiEvaluationRuns.all(campaignId, campaignId, limit).map((row) => ({
        id: row.id, campaignId: row.campaign_id, suite: row.suite, model: row.model,
        generatorVersion: row.generator_version, passed: row.passed, total: row.total,
        notes: row.notes, createdAt: row.created_at,
      }))
    },

    recordAiInferenceRun({ campaignId, surface, generatorVersion, status, durationMs, inputUnits = null, outputUnits = null, errorCategory = null }) {
      const run = { id: randomUUID(), campaignId, surface, generatorVersion, status, durationMs, inputUnits, outputUnits, errorCategory, createdAt: new Date().toISOString() }
      insertAiInferenceRun.run(run.id, campaignId, surface, generatorVersion, status, durationMs, inputUnits, outputUnits, errorCategory, run.createdAt)
      return run
    },

    listAiInferenceRuns(campaignId, limit = 100) {
      return aiInferenceRuns.all(campaignId, limit).map((row) => ({
        id: row.id, campaignId: row.campaign_id, surface: row.surface, generatorVersion: row.generator_version,
        status: row.status, durationMs: row.duration_ms, inputUnits: row.input_units,
        outputUnits: row.output_units, errorCategory: row.error_category, createdAt: row.created_at,
      }))
    },

    recordKnowledgeAnswer({ campaignId, subjectPlayerId, requestedByPlayerId, question, answer, generatorVersion, citationIds }) {
      if (citationIds.some((entryId) => !this.getCanonEntry(campaignId, entryId, { includeGmOnly: true }))) return null
      const record = { id: randomUUID(), campaignId, subjectPlayerId, question, answer, generatorVersion, citationIds: [...new Set(citationIds)], createdAt: new Date().toISOString() }
      database.exec('BEGIN IMMEDIATE')
      try {
        insertKnowledgeAnswer.run(record.id, campaignId, subjectPlayerId, requestedByPlayerId, question, answer, generatorVersion, record.createdAt)
        for (const entryId of record.citationIds) insertKnowledgeAnswerSource.run(record.id, entryId)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return record
    },

    recordKnowledgeAnswerFeedback(campaignId, playerId, answerId, rating) {
      if (!knowledgeAnswerForRequester.get(answerId, campaignId, playerId)) return null
      const feedback = { answerId, rating, createdAt: new Date().toISOString() }
      insertKnowledgeAnswerFeedback.run(randomUUID(), answerId, playerId, rating, feedback.createdAt)
      return feedback
    },

    listKnowledgeFeedbackExamples(campaignId, subjectPlayerId, limit = 10) {
      return knowledgeFeedbackExamples.all(campaignId, subjectPlayerId, limit).map((row) => ({
        question: row.question, rating: row.rating, generatorVersion: row.generator_version,
      }))
    },

    getKnowledgeFeedbackMetrics(campaignId) {
      const byVersion = {}
      for (const row of knowledgeFeedbackForCampaign.all(campaignId)) {
        const metrics = byVersion[row.generator_version] ?? { total: 0, useful: 0, incorrect: 0, incomplete: 0, secretLeak: 0 }
        const key = row.rating === 'secret_leak' ? 'secretLeak' : row.rating
        metrics.total += 1
        metrics[key] += 1
        byVersion[row.generator_version] = metrics
      }
      return Object.entries(byVersion).sort(([left], [right]) => left.localeCompare(right)).map(([generatorVersion, metrics]) => ({
        generatorVersion, ...metrics, usefulRate: metrics.total ? Number((metrics.useful / metrics.total).toFixed(4)) : null,
      }))
    },

    getIntelligenceSettings(campaignId) {
      const row = intelligenceSettings.get(campaignId)
      return row ? {
        autoPrepare: row.auto_prepare === 1,
        tasks: { canon: row.prepare_canon === 1, continuity: row.prepare_continuity === 1, recap: row.prepare_recap === 1 },
        updatedAt: row.updated_at,
      } : null
    },

    updateIntelligenceSettings(campaignId, playerId, { autoPrepare, tasks }) {
      updateIntelligenceSettings.run(autoPrepare ? 1 : 0, tasks.canon ? 1 : 0, tasks.continuity ? 1 : 0, tasks.recap ? 1 : 0, playerId, new Date().toISOString(), campaignId)
      return this.getIntelligenceSettings(campaignId)
    },

    queuePreparationRun(campaignId, sessionId, playerId, tasks) {
      const id = randomUUID()
      database.exec('BEGIN IMMEDIATE')
      try {
        const inserted = insertPreparationRun.run(id, campaignId, sessionId, JSON.stringify(tasks), playerId, new Date().toISOString())
        if (inserted.changes === 1) for (const [task, enabled] of Object.entries(tasks)) if (enabled) insertPreparationRunTask.run(id, task)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      const row = preparationRunForSession.get(campaignId, sessionId)
      return preparationRunWithOutcomes(row)
    },

    getPreparationRun(campaignId, runId) {
      const row = preparationRunById.get(runId, campaignId)
      return row ? preparationRunWithOutcomes(row) : null
    },

    listResumablePreparationRuns() {
      return resumablePreparationRuns.all().map((row) => preparationRunWithOutcomes(row))
    },

    recoverPreparationRuns() {
      resetRunningPreparationTasks.run()
      for (const row of resumablePreparationRuns.all()) this.refreshPreparationRun(row.campaign_id, row.id)
      return this.listResumablePreparationRuns()
    },

    startPreparationTask(campaignId, runId, task) {
      if (!preparationRunById.get(runId, campaignId)) return null
      if (startPreparationTask.run(new Date().toISOString(), runId, task).changes !== 1) return null
      return this.refreshPreparationRun(campaignId, runId)
    },

    finishPreparationTask(campaignId, runId, task, { status, result = null, error = null }) {
      if (!['complete', 'failed'].includes(status)) throw new Error('Preparation task must finish complete or failed.')
      finishPreparationTask.run(status, result ? JSON.stringify(result) : null, error, new Date().toISOString(), runId, task)
      return this.refreshPreparationRun(campaignId, runId)
    },

    retryPreparationRun(campaignId, runId) {
      if (!preparationRunById.get(runId, campaignId)) return null
      if (resetFailedPreparationTasks.run(runId).changes === 0) return this.getPreparationRun(campaignId, runId)
      return this.refreshPreparationRun(campaignId, runId)
    },

    refreshPreparationRun(campaignId, runId) {
      const row = preparationRunById.get(runId, campaignId)
      if (!row) return null
      const tasks = preparationTasks.all(runId)
      const terminal = tasks.every((task) => ['complete', 'failed'].includes(task.status))
      const status = terminal ? (tasks.some((task) => task.status === 'failed') ? 'failed' : 'complete') : tasks.every((task) => task.status === 'queued') ? 'queued' : 'running'
      const error = tasks.filter((task) => task.error).map((task) => `${task.task}: ${task.error}`).join('\n') || null
      updatePreparationRunState.run(status, error, terminal ? new Date().toISOString() : null, runId)
      return this.getPreparationRun(campaignId, runId)
    },

    listPreparationRuns(campaignId, limit = 20) {
      return preparationRuns.all(campaignId, limit).map((row) => preparationRunWithOutcomes(row))
    },

    listHouseRules(campaignId) {
      return houseRules.all(campaignId).map((row) => ({
        id: row.id, title: row.title, sourceRule: row.source_rule, interpretation: row.interpretation,
        ruling: row.ruling, status: row.status, revision: row.revision,
        createdAt: row.created_at, updatedAt: row.updated_at,
        sources: houseRuleRevisionSources.all(latestHouseRuleRevision.get(row.id).id).map((source) => ({
          messageId: source.message_id, roomId: source.room_id, roomName: source.room_name,
          senderName: source.sender_name, text: source.text, excerpt: source.excerpt,
          sentAt: source.sent_at, sequence: source.sequence,
        })),
      }))
    },

    listHouseRuleProposals(campaignId) {
      return houseRuleProposals.all(campaignId).map((row) => {
        const original = { title: row.title, sourceRule: row.source_rule, interpretation: row.interpretation, ruling: row.ruling }
        const decision = row.decision_action ? {
          action: row.decision_action,
          reason: row.decision_reason,
          title: row.decided_title,
          sourceRule: row.decided_source_rule,
          interpretation: row.decided_interpretation,
          ruling: row.decided_ruling,
          decidedByName: row.decided_by_name,
          decidedAt: row.decided_at,
          editedFields: ['title', 'sourceRule', 'interpretation', 'ruling'].filter((field) => row.decision_action !== 'reject' && original[field] !== ({ title: row.decided_title, sourceRule: row.decided_source_rule, interpretation: row.decided_interpretation, ruling: row.decided_ruling })[field]),
        } : null
        return {
          id: row.id, sessionId: row.session_id, generatorVersion: row.generator_version,
          status: row.status, original, decision, acceptedRuleId: row.accepted_rule_id,
          createdByName: row.created_by_name, createdAt: row.created_at,
          sources: houseRuleProposalSources.all(row.id).map((source) => ({
            messageId: source.message_id, roomId: source.room_id, roomName: source.room_name,
            senderName: source.sender_name, text: source.text, excerpt: source.excerpt,
            sentAt: source.sent_at, sequence: source.sequence,
          })),
        }
      })
    },

    createHouseRuleProposal(campaignId, playerId, { sessionId, generatorVersion, title, sourceRule, interpretation, ruling, sources = [] }) {
      const context = this.getCampaignSessionMessages(campaignId, sessionId, 5_000)
      const allowed = new Set(context?.messages.map((message) => message.id) ?? [])
      const resolved = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (!context || context.truncated || !sources.length || resolved.some((source) => !source.row || !allowed.has(source.messageId))) return null
      const id = randomUUID()
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertHouseRuleProposal.run(id, campaignId, sessionId, generatorVersion, title, sourceRule, interpretation, ruling, playerId, now)
        for (const source of resolved) insertHouseRuleProposalSource.run(id, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return this.listHouseRuleProposals(campaignId).find((proposal) => proposal.id === id)
    },

    decideHouseRuleProposal(campaignId, playerId, proposalId, { action, reason, title = null, sourceRule = null, interpretation = null, ruling = null }) {
      const proposal = houseRuleProposalForCampaign.get(proposalId, campaignId)
      if (!proposal) return { outcome: 'not_found' }
      if (proposal.status !== 'proposed') return { outcome: 'conflict', proposal: this.listHouseRuleProposals(campaignId).find((item) => item.id === proposalId) }
      const rejected = action === 'reject'
      const next = rejected ? null : { title, sourceRule, interpretation, ruling }
      if (!['accept', 'reject'].includes(action) || !reason || (!rejected && Object.values(next).some((value) => !value))) return { outcome: 'invalid' }
      const decisionAction = rejected ? 'reject' : Object.entries(next).some(([field, value]) => value !== ({ title: proposal.title, sourceRule: proposal.source_rule, interpretation: proposal.interpretation, ruling: proposal.ruling })[field]) ? 'edit_accept' : 'accept'
      const ruleId = rejected ? null : randomUUID()
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (!rejected) {
          const revisionId = randomUUID()
          insertHouseRule.run(ruleId, campaignId, next.title, next.sourceRule, next.interpretation, next.ruling, playerId, now, now)
          insertHouseRuleRevision.run(revisionId, ruleId, 0, next.title, next.sourceRule, next.interpretation, next.ruling, 'active', reason, playerId, now)
          for (const source of houseRuleProposalSources.all(proposalId)) insertHouseRuleRevisionSource.run(revisionId, source.message_id, source.excerpt)
        }
        if (decideHouseRuleProposal.run(rejected ? 'rejected' : 'accepted', decisionAction, reason, next?.title ?? null, next?.sourceRule ?? null, next?.interpretation ?? null, next?.ruling ?? null, ruleId, playerId, now, proposalId, campaignId).changes !== 1) throw new Error('house_rule_proposal_conflict')
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return {
        outcome: rejected ? 'rejected' : 'accepted',
        proposal: this.listHouseRuleProposals(campaignId).find((item) => item.id === proposalId),
        rule: ruleId ? this.listHouseRules(campaignId).find((item) => item.id === ruleId) : null,
      }
    },

    createHouseRule(campaignId, playerId, { title, sourceRule, interpretation, ruling, reason, sources = [] }) {
      const resolved = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (resolved.some((source) => !source.row)) return null
      const id = randomUUID()
      const revisionId = randomUUID()
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertHouseRule.run(id, campaignId, title, sourceRule, interpretation, ruling, playerId, now, now)
        insertHouseRuleRevision.run(revisionId, id, 0, title, sourceRule, interpretation, ruling, 'active', reason, playerId, now)
        for (const source of resolved) insertHouseRuleRevisionSource.run(revisionId, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return this.listHouseRules(campaignId).find((rule) => rule.id === id)
    },

    reviseHouseRule(campaignId, playerId, ruleId, { title, sourceRule, interpretation, ruling, status, reason, expectedRevision, sources = [] }) {
      const current = houseRuleForCampaign.get(ruleId, campaignId)
      if (!current) return { outcome: 'not_found' }
      if (current.revision !== expectedRevision) return { outcome: 'conflict', rule: this.listHouseRules(campaignId).find((rule) => rule.id === ruleId) }
      const resolved = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (resolved.some((source) => !source.row)) return { outcome: 'invalid_source' }
      const now = new Date().toISOString()
      const revisionId = randomUUID()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateHouseRule.run(title, sourceRule, interpretation, ruling, status, now, ruleId, campaignId, expectedRevision).changes !== 1) throw new Error('house_rule_conflict')
        insertHouseRuleRevision.run(revisionId, ruleId, expectedRevision + 1, title, sourceRule, interpretation, ruling, status, reason, playerId, now)
        for (const source of resolved) insertHouseRuleRevisionSource.run(revisionId, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: 'revised', rule: this.listHouseRules(campaignId).find((rule) => rule.id === ruleId) }
    },

    listHouseRuleHistory(campaignId, ruleId) {
      if (!houseRuleForCampaign.get(ruleId, campaignId)) return null
      return houseRuleRevisions.all(ruleId).map((row) => ({
        id: row.id, revision: row.revision, title: row.title, sourceRule: row.source_rule,
        interpretation: row.interpretation, ruling: row.ruling, status: row.status,
        reason: row.reason, playerName: row.player_name, createdAt: row.created_at,
        sources: houseRuleRevisionSources.all(row.id).map((source) => ({
          messageId: source.message_id, roomId: source.room_id, roomName: source.room_name,
          senderName: source.sender_name, text: source.text, excerpt: source.excerpt,
          sentAt: source.sent_at, sequence: source.sequence,
        })),
      }))
    },

    listFactionClocks(campaignId) {
      const proposals = factionProposals.all(campaignId)
      return factionClocks.all(campaignId).map((row) => ({
        id: row.id, name: row.name, goal: row.goal, progress: row.progress, segments: row.segments,
        revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
        proposals: proposals.filter((proposal) => proposal.clock_id === row.id).map((proposal) => ({
          id: proposal.id, summary: proposal.summary, assumptions: proposal.assumptions,
          baseProgress: proposal.base_progress, proposedProgress: proposal.proposed_progress, sessionId: proposal.session_id,
          status: proposal.status, generatorVersion: proposal.generator_version,
          createdByName: proposal.created_by_name, decidedByName: proposal.decided_by_name,
          createdAt: proposal.created_at, decidedAt: proposal.decided_at,
          sources: factionProposalSources.all(proposal.id).map((source) => ({
            messageId: source.message_id, roomId: source.room_id, roomName: source.room_name,
            senderName: source.sender_name, text: source.text, excerpt: source.excerpt,
            sentAt: source.sent_at, sequence: source.sequence,
          })),
        })),
      }))
    },

    createFactionClock(campaignId, playerId, { name, goal, progress, segments }) {
      const id = randomUUID()
      const now = new Date().toISOString()
      insertFactionClock.run(id, campaignId, name, goal, progress, segments, playerId, now, now)
      return this.listFactionClocks(campaignId).find((clock) => clock.id === id)
    },

    createFactionProposal(campaignId, playerId, clockId, { summary, assumptions, proposedProgress, generatorVersion, sessionId, sources }) {
      const clock = factionClockForCampaign.get(clockId, campaignId)
      if (!clock || !this.listCampaignSessions(campaignId).some((session) => session.id === sessionId)) return null
      const resolved = sources.map((source) => ({ ...source, row: messageForCampaign.get(source.messageId, campaignId) }))
      if (resolved.some((source) => !source.row)) return null
      const id = randomUUID()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertFactionProposal.run(id, clockId, summary, assumptions, clock.progress, proposedProgress, sessionId, generatorVersion, playerId, new Date().toISOString())
        for (const source of resolved) insertFactionProposalSource.run(id, source.messageId, source.excerpt ?? null)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return this.listFactionClocks(campaignId).find((clock) => clock.id === clockId)
    },

    decideFactionProposal(campaignId, playerId, proposalId, action) {
      const proposal = factionProposalForCampaign.get(proposalId, campaignId)
      if (!proposal) return { outcome: 'not_found' }
      if (proposal.status !== 'proposed') return { outcome: 'decided', clocks: this.listFactionClocks(campaignId) }
      if (action === 'accept' && proposal.progress !== proposal.base_progress) return { outcome: 'conflict', clocks: this.listFactionClocks(campaignId) }
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        decideFactionProposal.run(action === 'accept' ? 'accepted' : 'rejected', playerId, now, proposalId)
        if (action === 'accept') advanceFactionClock.run(Math.min(proposal.segments, Math.max(0, proposal.proposed_progress)), now, proposal.clock_id)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: action === 'accept' ? 'accepted' : 'rejected', clocks: this.listFactionClocks(campaignId) }
    },

    setSpotlightConsent(playerId, enabled) {
      const current = spotlightConsentForPlayer.get(playerId)
      if (current && (current.enabled === 1) === enabled) return this.getSpotlightConsent(playerId)
      const sequence = latestMessageSequence.get().sequence
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        upsertSpotlightConsent.run(playerId, enabled ? 1 : 0, sequence, now)
        insertSpotlightConsentEvent.run(randomUUID(), playerId, enabled ? 1 : 0, sequence, now)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return this.getSpotlightConsent(playerId)
    },

    getSpotlightConsent(playerId) {
      const row = spotlightConsentForPlayer.get(playerId)
      return {
        enabled: row?.enabled === 1,
        updatedAt: row?.updated_at ?? null,
        history: spotlightConsentHistory.all(playerId).map((event) => ({ enabled: event.enabled === 1, effectiveSequence: event.effective_sequence, createdAt: event.created_at })),
        reports: this.listSpotlightReportsForPlayer(playerId),
      }
    },

    getSpotlightParticipants(campaignId) {
      return spotlightParticipants.all(campaignId).map((row) => ({ id: row.id, name: row.name, enabled: row.enabled === 1 }))
    },

    createSpotlightReport(campaignId, playerId, sessionId) {
      const context = this.getCampaignSessionMessages(campaignId, sessionId, 5_000)
      if (!context || context.truncated) return null
      const existing = spotlightReportForSession.get(campaignId, sessionId)
      if (existing) return publicSpotlightReport(existing)
      const participants = spotlightMessageCounts.all(campaignId, context.session.startSequence, context.session.endSequence)
      const totalMessages = participants.reduce((sum, participant) => sum + participant.message_count, 0)
      const id = randomUUID()
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertSpotlightReport.run(id, campaignId, sessionId, context.session.title, context.session.startSequence, context.session.endSequence, totalMessages, playerId, now)
        for (const participant of participants) insertSpotlightReportParticipant.run(id, participant.id, participant.message_count, totalMessages ? Number((participant.message_count / totalMessages).toFixed(4)) : 0)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return publicSpotlightReport(spotlightReportForSession.get(campaignId, sessionId))
    },

    listSpotlightReportsForPlayer(playerId) {
      return spotlightReportsForPlayer.all(playerId).map((row) => {
        const participant = spotlightReportParticipants.all(row.id).find((item) => item.player_id === playerId)
        return { id: row.id, session: { id: row.session_id, title: row.session_title }, messages: participant.message_count, share: participant.share, totalMessages: row.total_messages, createdAt: row.created_at }
      })
    },

    listPlayerMessages(campaignId, playerId, limit = 20) {
      return recentPlayerMessages.all(campaignId, playerId, limit).reverse().map((row) => ({ text: row.text, sentAt: row.sent_at }))
    },

    close() {
      database.close()
    },
  }
}
