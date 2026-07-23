import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
      removed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
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
  `)

  const playerColumns = database.prepare('PRAGMA table_info(players)').all()
  if (!playerColumns.some((column) => column.name === 'role')) {
    database.exec("ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member'))")
    database.exec("UPDATE players SET role = 'owner' WHERE rowid IN (SELECT MIN(rowid) FROM players GROUP BY campaign_id)")
  }
  if (!playerColumns.some((column) => column.name === 'removed_at')) database.exec('ALTER TABLE players ADD COLUMN removed_at TEXT')

  const campaignByInvite = database.prepare('SELECT * FROM campaigns WHERE invite_code = ?')
  const campaignById = database.prepare('SELECT * FROM campaigns WHERE id = ?')
  const roomsByCampaign = database.prepare('SELECT * FROM rooms WHERE campaign_id = ? ORDER BY rowid')
  const insertCampaign = database.prepare('INSERT INTO campaigns (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)')
  const updateInvitation = database.prepare('UPDATE campaigns SET invite_code = ? WHERE id = ?')
  const insertRoom = database.prepare('INSERT INTO rooms (id, campaign_id, slug, name, description) VALUES (?, ?, ?, ?, ?)')
  const insertPlayer = database.prepare('INSERT INTO players (id, campaign_id, name, role, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const playersByCampaign = database.prepare('SELECT * FROM players WHERE campaign_id = ? AND removed_at IS NULL ORDER BY rowid')
  const playerForCampaign = database.prepare('SELECT * FROM players WHERE id = ? AND campaign_id = ? AND removed_at IS NULL')
  const removePlayer = database.prepare('UPDATE players SET removed_at = ? WHERE id = ?')
  const playerByToken = database.prepare(`
    SELECT players.*, campaigns.name AS campaign_name, campaigns.invite_code
    FROM players JOIN campaigns ON campaigns.id = players.campaign_id
    WHERE players.token_hash = ? AND players.removed_at IS NULL
  `)
  const roomForCampaign = database.prepare('SELECT * FROM rooms WHERE id = ? AND campaign_id = ?')
  const insertMessage = database.prepare(`
    INSERT INTO messages (id, room_id, player_id, client_message_id, text, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const messagesForRoom = database.prepare(`
    SELECT * FROM (
      SELECT messages.id, messages.client_message_id, messages.player_id, players.name AS sender_name,
             messages.text, messages.sent_at, messages.rowid AS sequence
      FROM messages JOIN players ON players.id = messages.player_id
      WHERE messages.room_id = ?
      ORDER BY messages.rowid DESC LIMIT 100
    ) ORDER BY sequence ASC
  `)

  function createPlayer(campaignId, name, role = 'member') {
    const token = randomBytes(32).toString('base64url')
    const player = { id: randomUUID(), campaignId, name, role, token }
    insertPlayer.run(player.id, campaignId, name, role, tokenHash(token), new Date().toISOString())
    return player
  }

  return {
    createCampaign(campaignName, playerName) {
      const campaign = { id: randomUUID(), name: campaignName, inviteCode: randomBytes(5).toString('hex') }
      database.exec('BEGIN IMMEDIATE')
      try {
        insertCampaign.run(campaign.id, campaign.name, campaign.inviteCode, new Date().toISOString())
        for (const [slug, name, description] of defaultRooms) insertRoom.run(randomUUID(), campaign.id, slug, name, description)
        const player = createPlayer(campaign.id, playerName, 'owner')
        database.exec('COMMIT')
        return { campaign: publicCampaign(campaignById.get(campaign.id), roomsByCampaign.all(campaign.id)), player }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    joinCampaign(inviteCode, playerName) {
      const row = campaignByInvite.get(inviteCode)
      if (!row) return null
      const player = createPlayer(row.id, playerName)
      return { campaign: publicCampaign(row, roomsByCampaign.all(row.id)), player }
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
      insertMessage.run(message.id, roomId, playerId, clientMessageId, text, message.sentAt)
      return message
    },

    listMessages(roomId) {
      return messagesForRoom.all(roomId).map((row) => ({
        id: row.id,
        clientMessageId: row.client_message_id,
        senderId: row.player_id,
        senderName: row.sender_name,
        text: row.text,
        sentAt: row.sent_at,
      }))
    },

    close() {
      database.close()
    },
  }
}
