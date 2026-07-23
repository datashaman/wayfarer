import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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

function publicCanonEntry(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    claim: row.claim,
    visibility: row.visibility,
    revision: row.revision,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name ?? null,
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
  database.exec("INSERT OR IGNORE INTO campaign_notes (campaign_id) SELECT id FROM campaigns")
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
  const insertPlayer = database.prepare('INSERT INTO players (id, campaign_id, name, role, token_hash, recovery_key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const playersByCampaign = database.prepare('SELECT * FROM players WHERE campaign_id = ? AND removed_at IS NULL ORDER BY rowid')
  const activePlayerByName = database.prepare('SELECT * FROM players WHERE campaign_id = ? AND name = ? COLLATE NOCASE AND removed_at IS NULL')
  const playerForCampaign = database.prepare('SELECT * FROM players WHERE id = ? AND campaign_id = ? AND removed_at IS NULL')
  const removePlayer = database.prepare('UPDATE players SET removed_at = ? WHERE id = ?')
  const updatePlayerCredentials = database.prepare('UPDATE players SET token_hash = ?, recovery_key_hash = ? WHERE id = ?')
  const updateRecoveryKey = database.prepare('UPDATE players SET recovery_key_hash = ? WHERE id = ?')
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
  const campaignNote = database.prepare(`
    SELECT campaign_notes.*, players.name AS updated_by_name
    FROM campaign_notes LEFT JOIN players ON players.id = campaign_notes.updated_by_player_id
    WHERE campaign_notes.campaign_id = ?
  `)
  const updateCampaignNote = database.prepare(`
    UPDATE campaign_notes SET body = ?, revision = ?, updated_by_player_id = ?, updated_at = ?
    WHERE campaign_id = ?
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
      id, proposal_id, player_id, action, reason, accepted_title, accepted_claim, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCanonEntry = database.prepare(`
    INSERT INTO canon_entries (
      id, proposal_id, campaign_id, kind, title, claim, visibility, revision,
      status, created_by_player_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
  `)
  const canonEntriesForCampaign = database.prepare(`
    SELECT canon_entries.*, players.name AS created_by_name
    FROM canon_entries
    JOIN players ON players.id = canon_entries.created_by_player_id
    WHERE canon_entries.campaign_id = ? AND canon_entries.status = 'active'
    ORDER BY canon_entries.rowid DESC
  `)

  function createPlayer(campaignId, name, role = 'member') {
    const token = randomBytes(32).toString('base64url')
    const recoveryCode = createRecoveryCode()
    const player = { id: randomUUID(), campaignId, name, role, token, recoveryCode }
    insertPlayer.run(player.id, campaignId, name, role, tokenHash(token), recoveryHash(recoveryCode), new Date().toISOString())
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
      const existing = canonProposalByExtractionKey.get(campaignId, extractionKey)
      if (existing) return { outcome: 'existing', proposal: publicCanonProposal(existing, canonSourcesForProposal.all(existing.id)) }
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

    getCanonProposal(campaignId, proposalId) {
      const row = canonProposalById.get(proposalId, campaignId)
      return row ? publicCanonProposal(row, canonSourcesForProposal.all(proposalId)) : null
    },

    listCanonProposals(campaignId, { includeGmOnly = false } = {}) {
      return canonProposalsForCampaign.all(campaignId)
        .filter((row) => includeGmOnly || row.visibility === 'campaign')
        .map((row) => publicCanonProposal(row, canonSourcesForProposal.all(row.id)))
    },

    decideCanonProposal(campaignId, playerId, proposalId, { action, reason = null, title = null, claim = null }) {
      const proposal = canonProposalById.get(proposalId, campaignId)
      if (!proposal) return { outcome: 'not_found' }
      if (proposal.status !== 'proposed') return { outcome: 'already_decided', proposal: this.getCanonProposal(campaignId, proposalId) }
      const nextStatus = action === 'accept' || action === 'edit_accept' ? 'accepted' : action === 'dispute' ? 'disputed' : 'rejected'
      const acceptedTitle = action === 'edit_accept' ? title : proposal.title
      const acceptedClaim = action === 'edit_accept' ? claim : proposal.claim
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (updateCanonProposalStatus.run(nextStatus, proposalId, campaignId).changes !== 1) throw new Error('canon_proposal_conflict')
        insertCanonDecision.run(randomUUID(), proposalId, playerId, action, reason, acceptedTitle, acceptedClaim, now)
        if (nextStatus === 'accepted') {
          insertCanonEntry.run(randomUUID(), proposalId, campaignId, proposal.kind, acceptedTitle, acceptedClaim, proposal.visibility, playerId, now, now)
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { outcome: nextStatus, proposal: this.getCanonProposal(campaignId, proposalId) }
    },

    listCanonEntries(campaignId, { includeGmOnly = false } = {}) {
      return canonEntriesForCampaign.all(campaignId)
        .filter((row) => includeGmOnly || row.visibility === 'campaign')
        .map(publicCanonEntry)
    },

    close() {
      database.close()
    },
  }
}
