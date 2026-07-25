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
  return {
    id: row.id,
    clientMessageId: row.client_message_id,
    senderId: row.player_id,
    senderName: row.sender_name,
    text: row.text,
    sentAt: row.sent_at,
    sequence: row.sequence,
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

function publicCanonEntry(row, sources = [], audiences = []) {
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
    revision: row.revision,
    status: row.status === 'active' ? 'active' : row.retired_reason ?? 'superseded',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_notes (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      updated_by_player_id TEXT REFERENCES players(id),
      updated_at TEXT
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
  for (const table of ['continuity_briefs', 'contradiction_reports']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
    if (!columns.some((column) => column.name === 'session_id')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_id TEXT`)
    if (!columns.some((column) => column.name === 'session_title')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_title TEXT`)
    if (!columns.some((column) => column.name === 'session_status')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_status TEXT CHECK(session_status IS NULL OR session_status IN ('open', 'closed'))`)
    if (!columns.some((column) => column.name === 'session_start_sequence')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_start_sequence INTEGER`)
    if (!columns.some((column) => column.name === 'session_end_sequence')) database.exec(`ALTER TABLE ${table} ADD COLUMN session_end_sequence INTEGER`)
  }
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
    INSERT OR IGNORE INTO messages (id, room_id, player_id, client_message_id, text, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const messageByClientId = database.prepare(`
    SELECT messages.id, messages.client_message_id, messages.player_id, players.name AS sender_name,
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
           players.name AS sender_name, messages.text, messages.sent_at,
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
      SELECT messages.id, messages.client_message_id, messages.player_id, players.name AS sender_name,
             messages.text, messages.sent_at, messages.rowid AS sequence
      FROM messages JOIN players ON players.id = messages.player_id
      WHERE messages.room_id = ?
      ORDER BY messages.rowid DESC LIMIT ?
    ) ORDER BY sequence ASC
  `)
  const olderMessagesForRoom = database.prepare(`
    SELECT * FROM (
      SELECT messages.id, messages.client_message_id, messages.player_id, players.name AS sender_name,
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
           players.name AS sender_name, messages.text, messages.sent_at, messages.rowid AS sequence
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
             players.name AS sender_name, messages.text, messages.sent_at,
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
           players.name AS sender_name, messages.text, messages.sent_at,
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
           rooms.id AS room_id, rooms.name AS room_name, players.name AS sender_name
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
           rooms.id AS room_id, rooms.name AS room_name, players.name AS sender_name
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
    SELECT canon_entries.*, players.name AS created_by_name
    FROM canon_entries
    JOIN players ON players.id = canon_entries.created_by_player_id
    WHERE canon_entries.id = ? AND canon_entries.campaign_id = ?
  `)
  const canonEntriesForCampaign = database.prepare(`
    SELECT canon_entries.*, players.name AS created_by_name
    FROM canon_entries
    JOIN players ON players.id = canon_entries.created_by_player_id
    WHERE canon_entries.campaign_id = ? AND canon_entries.status = 'active'
    ORDER BY canon_entries.rowid DESC
  `)
  const canonSourcesForEntry = database.prepare(`
    SELECT canon_proposal_sources.message_id, canon_proposal_sources.excerpt,
           messages.text, messages.sent_at, messages.rowid AS sequence,
           rooms.id AS room_id, rooms.name AS room_name, players.name AS sender_name
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
      id, campaign_id, generator_version, session_id, session_title, session_status,
      session_start_sequence, session_end_sequence, created_by_player_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
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
           rooms.id AS room_id, rooms.name AS room_name, players.name AS sender_name
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
           rooms.id AS room_id, rooms.name AS room_name, players.name AS sender_name
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

  function createPlayer(campaignId, name, role = 'member') {
    const token = randomBytes(32).toString('base64url')
    const recoveryCode = createRecoveryCode()
    const knowledgeRole = role === 'owner' ? 'gm' : 'player'
    const player = { id: randomUUID(), campaignId, name, role, knowledgeRole, token, recoveryCode }
    insertPlayer.run(player.id, campaignId, name, role, knowledgeRole, tokenHash(token), recoveryHash(recoveryCode), new Date().toISOString())
    initializePlayerReads.run(new Date().toISOString())
    return player
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
      const inserted = insertMessage.run(message.id, roomId, playerId, clientMessageId, text, message.sentAt).changes === 1
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
      upsertCanonScanState.run(campaignId, throughSequence, playerId, new Date().toISOString())
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
      return { canon, continuity, deduplication: this.getCanonProposalMatchMetrics(campaignId) }
    },

    listCanonEntries(campaignId, { includeGmOnly = false, viewerPlayerId = null } = {}) {
      return canonEntriesForCampaign.all(campaignId)
        .map((row) => ({ row, audiences: canonAudiencesForEntry.all(row.id) }))
        .filter(({ row, audiences }) => includeGmOnly || row.visibility === 'campaign' || audiences.some((audience) => audience.id === viewerPlayerId))
        .map(({ row, audiences }) => publicCanonEntry(row, canonSourcesForEntry.all(row.id), audiences))
    },

    getCanonEntry(campaignId, entryId, { includeGmOnly = false, viewerPlayerId = null } = {}) {
      const row = canonEntryById.get(entryId, campaignId)
      const audiences = row ? canonAudiencesForEntry.all(entryId) : []
      if (!row || (!includeGmOnly && row.visibility !== 'campaign' && !audiences.some((audience) => audience.id === viewerPlayerId))) return null
      return publicCanonEntry(row, canonSourcesForEntry.all(entryId), audiences)
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
        entries: this.listCanonEntries(campaignId, { viewerPlayerId: playerId }),
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

    createContinuityBrief({ campaignId, playerId, generatorVersion, session = null, threads }) {
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
          briefId, campaignId, generatorVersion, session?.id ?? null, session?.title ?? null,
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

    close() {
      database.close()
    },
  }
}
