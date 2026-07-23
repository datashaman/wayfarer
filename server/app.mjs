import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { defaultIceServers } from './config.mjs'
import { createStore } from './store.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 65_536) throw new Error('request_too_large')
  }
  return JSON.parse(body || '{}')
}

function cleanName(value, maximum) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name && name.length <= maximum ? name : null
}

function cleanDescription(value, maximum) {
  const description = typeof value === 'string' ? value.trim() : ''
  return description.length <= maximum ? description : null
}

export function createRoomServer({ databasePath = join(root, 'data', 'wayfarer.sqlite'), dev = false, iceServers = defaultIceServers } = {}) {
  const store = createStore(databasePath)
  const clients = new Map()
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    try {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
      const requestSession = token ? store.getSession(token) : null

      if (request.method === 'GET' && request.url === '/api/config') {
        sendJson(response, requestSession ? 200 : 401, requestSession ? { iceServers } : { error: 'Session not found.' })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/manage') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        sendJson(response, 200, store.getCampaignManagement(requestSession.campaign.id))
        return
      }

      if (request.method === 'GET' && request.url?.startsWith('/api/campaign/search')) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const query = new URL(request.url, 'http://localhost').searchParams.get('q')?.trim() ?? ''
        if (!query || query.length > 80) {
          sendJson(response, 400, { error: 'Search text must be between 1 and 80 characters.' })
          return
        }
        sendJson(response, 200, { results: store.searchMessages(requestSession.campaign.id, query) })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/notes') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        sendJson(response, 200, { note: store.getCampaignNote(requestSession.campaign.id) })
        return
      }

      if (request.method === 'PUT' && request.url === '/api/campaign/notes') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const body = await readJson(request)
        const noteBody = typeof body.body === 'string' && body.body.length <= 20_000 ? body.body : null
        const revision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        if (noteBody === null || revision === null) {
          sendJson(response, 400, { error: 'Note text or revision is invalid.' })
          return
        }
        const result = store.updateCampaignNote(requestSession.campaign.id, requestSession.player.id, noteBody, revision)
        if (result.conflict) {
          sendJson(response, 409, { error: 'The notes changed at another seat. Load the latest copy before saving.', note: result.note })
          return
        }
        broadcastCampaignEvent(requestSession.campaign.id, envelope('campaign.note_updated', requestSession.campaign.id, { note: result.note }))
        sendJson(response, 200, { note: result.note })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/invitation') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const campaign = store.rotateInvitation(requestSession.campaign.id)
        broadcastCampaign(campaign)
        sendJson(response, 200, { campaign })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/rooms') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const name = cleanName(body.name, 40)
        const description = cleanDescription(body.description, 120)
        if (!name || description === null) {
          sendJson(response, 400, { error: 'Room name or description is invalid.' })
          return
        }
        const campaign = store.createRoom(requestSession.campaign.id, name, description)
        broadcastCampaign(campaign)
        sendJson(response, 201, { campaign })
        return
      }

      const roomMutation = request.url?.match(/^\/api\/campaign\/rooms\/([^/]+)$/)
      if (request.method === 'PATCH' && roomMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const name = cleanName(body.name, 40)
        const description = cleanDescription(body.description, 120)
        if (!name || description === null) {
          sendJson(response, 400, { error: 'Room name or description is invalid.' })
          return
        }
        const campaign = store.updateRoom(requestSession.campaign.id, roomMutation[1], name, description)
        if (campaign) broadcastCampaign(campaign)
        sendJson(response, campaign ? 200 : 404, campaign ? { campaign } : { error: 'Room not found.' })
        return
      }

      if (request.method === 'DELETE' && roomMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const result = store.archiveRoom(requestSession.campaign.id, roomMutation[1])
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Room not found.' })
          return
        }
        if (result.outcome === 'last_room') {
          sendJson(response, 400, { error: 'A campaign must keep at least one active room.' })
          return
        }
        broadcastCampaign(result.campaign)
        sendJson(response, 200, { campaign: result.campaign })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/rooms/reorder') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const roomIds = Array.isArray(body.roomIds) && body.roomIds.every((roomId) => typeof roomId === 'string') ? body.roomIds : null
        const campaign = roomIds ? store.reorderRooms(requestSession.campaign.id, roomIds) : null
        if (campaign) broadcastCampaign(campaign)
        sendJson(response, campaign ? 200 : 400, campaign ? { campaign } : { error: 'Room order must include every active room once.' })
        return
      }

      const playerRemoval = request.url?.match(/^\/api\/campaign\/players\/([^/]+)$/)
      if (request.method === 'DELETE' && playerRemoval) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const result = store.removePlayer(requestSession.campaign.id, playerRemoval[1])
        if (result.outcome === 'owner') {
          sendJson(response, 400, { error: 'The campaign owner cannot be removed.' })
          return
        }
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Player not found.' })
          return
        }
        for (const [socket, client] of clients) {
          if (client.player.id !== playerRemoval[1]) continue
          send(socket, envelope('session.revoked', client.roomId || client.campaign.id, { reason: 'removed' }))
          socket.close(4003, 'Player removed')
        }
        sendJson(response, 200, result.management)
        return
      }

      const recoveryReset = request.url?.match(/^\/api\/campaign\/players\/([^/]+)\/recovery$/)
      if (request.method === 'POST' && recoveryReset) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const recoveryCode = store.resetRecoveryKey(requestSession.campaign.id, recoveryReset[1])
        sendJson(response, recoveryCode ? 200 : 404, recoveryCode ? { recoveryCode } : { error: 'Player not found.' })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaigns') {
        const body = await readJson(request)
        const campaignName = cleanName(body.campaignName, 80)
        const playerName = cleanName(body.playerName, 40)
        if (!campaignName || !playerName) {
          sendJson(response, 400, { error: 'Campaign and player names are required.' })
          return
        }
        sendJson(response, 201, store.createCampaign(campaignName, playerName))
        return
      }

      const invitation = request.url?.match(/^\/api\/invitations\/([a-z0-9]{10})\/join$/)
      if (request.method === 'POST' && invitation) {
        const body = await readJson(request)
        const playerName = cleanName(body.playerName, 40)
        if (!playerName) {
          sendJson(response, 400, { error: 'Player name is required.' })
          return
        }
        const joined = store.joinCampaign(invitation[1], playerName)
        if (!joined) {
          sendJson(response, 404, { error: 'This invitation is no longer available.' })
          return
        }
        if (joined.duplicate) {
          sendJson(response, 409, { error: 'That name already has a seat in this campaign.' })
          return
        }
        sendJson(response, 201, joined)
        return
      }

      const recovery = request.url?.match(/^\/api\/invitations\/([a-z0-9]{10})\/recover$/)
      if (request.method === 'POST' && recovery) {
        const body = await readJson(request)
        const playerName = cleanName(body.playerName, 40)
        const recoveryCode = typeof body.recoveryCode === 'string' && body.recoveryCode.length <= 64 ? body.recoveryCode : ''
        if (!playerName || !recoveryCode) {
          sendJson(response, 400, { error: 'Player name and seat key are required.' })
          return
        }
        const recovered = store.recoverPlayer(recovery[1], playerName, recoveryCode)
        if (!recovered) {
          sendJson(response, 404, { error: 'This invitation is no longer available.' })
          return
        }
        if (recovered.invalid) {
          sendJson(response, 401, { error: 'That name and seat key do not match.' })
          return
        }
        for (const [socket, client] of clients) {
          if (client.player.id !== recovered.player.id) continue
          send(socket, envelope('session.revoked', client.roomId || client.campaign.id, { reason: 'recovered' }))
          socket.close(4003, 'Seat recovered')
        }
        sendJson(response, 200, recovered)
        return
      }

      if (request.method === 'GET' && request.url === '/api/session') {
        sendJson(response, requestSession ? 200 : 401, requestSession ?? { error: 'Session not found.' })
        return
      }

      if (request.url?.startsWith('/api/')) {
        sendJson(response, 404, { error: 'Not found.' })
        return
      }

      if (dev) {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Wayfarer room server')
        return
      }

      const requested = request.url === '/' ? '/index.html' : (request.url ?? '/index.html')
      const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '')
      let file = join(dist, safePath)
      if (!existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html')
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(response)
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : error?.message === 'request_too_large' ? 413 : 500
      sendJson(response, status, { error: status === 500 ? 'Unexpected server error.' : 'Invalid request.' })
    }
  })
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient({ req }, done) {
      const token = new URL(req.url, 'http://localhost').searchParams.get('token') ?? ''
      const session = token ? store.getSession(token) : null
      if (!session) {
        done(false, 401, 'Unauthorized')
        return
      }
      req.session = session
      done(true)
    },
  })

  function envelope(type, roomId, payload) {
    return { type, id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload }
  }

  function send(socket, event) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
  }

  function members(roomId) {
    return [...clients.entries()].filter(([, client]) => client.roomId === roomId)
  }

  function participant(client) {
    return { playerId: client.player.id, name: client.player.name, muted: client.muted }
  }

  function broadcast(roomId, event, except) {
    for (const [socket] of members(roomId)) if (socket !== except) send(socket, event)
  }

  function broadcastCampaign(campaign) {
    const event = envelope('campaign.updated', campaign.id, { campaign })
    for (const [socket, client] of clients) {
      if (client.campaign.id !== campaign.id) continue
      client.campaign = campaign
      send(socket, event)
    }
  }

  function broadcastCampaignEvent(campaignId, event) {
    for (const [socket, client] of clients) if (client.campaign.id === campaignId) send(socket, event)
  }

  function presenceSnapshot(roomId) {
    if (!roomId) return
    broadcast(roomId, envelope('presence.snapshot', roomId, { participants: members(roomId).map(([, client]) => participant(client)) }))
  }

  function leaveVoice(socket, client) {
    if (!client.inVoice || !client.roomId) return
    client.inVoice = false
    client.muted = false
    broadcast(client.roomId, envelope('voice.participant_left', client.roomId, { playerId: client.player.id }), socket)
  }

  function validEnvelope(event) {
    return event && typeof event === 'object' && typeof event.type === 'string' && typeof event.roomId === 'string' && event.payload && typeof event.payload === 'object'
  }

  wss.on('connection', (socket, request) => {
    const session = request.session
    const client = { player: session.player, campaign: session.campaign, roomId: '', inVoice: false, muted: false }
    clients.set(socket, client)

    socket.on('message', (raw) => {
      let event
      try {
        event = JSON.parse(String(raw))
      } catch {
        send(socket, envelope('error', client.roomId || 'unknown', { code: 'invalid_json', message: 'Invalid event.', retryable: false }))
        return
      }
      if (!validEnvelope(event)) {
        send(socket, envelope('error', client.roomId || 'unknown', { code: 'invalid_event', message: 'Invalid event.', retryable: false }))
        return
      }

      if (event.type === 'room.subscribe') {
        const room = store.getRoom(event.roomId, client.campaign.id)
        if (!room) {
          send(socket, envelope('error', event.roomId, { code: 'room_forbidden', message: 'Room not found.', retryable: false }))
          return
        }
        const previousRoom = client.roomId
        if (previousRoom && previousRoom !== room.id) leaveVoice(socket, client)
        client.roomId = room.id
        if (previousRoom && previousRoom !== client.roomId) presenceSnapshot(previousRoom)
        const roomMembers = members(client.roomId)
        send(socket, envelope('room.snapshot', client.roomId, {
          participants: roomMembers.map(([, member]) => participant(member)),
          voiceParticipants: roomMembers.filter(([, member]) => member.inVoice).map(([, member]) => participant(member)),
          messages: store.listMessages(client.roomId),
        }))
        presenceSnapshot(client.roomId)
        return
      }

      if (!client.roomId || event.roomId !== client.roomId) return

      if (event.type === 'chat.send') {
        const text = typeof event.payload.text === 'string' ? event.payload.text.trim().slice(0, 2_000) : ''
        const clientMessageId = typeof event.payload.clientMessageId === 'string' ? event.payload.clientMessageId.slice(0, 100) : ''
        if (!text || !clientMessageId) {
          send(socket, envelope('error', client.roomId, { code: 'invalid_message', message: 'Message is invalid.', retryable: false }))
          return
        }
        const stored = store.addMessage({
          roomId: client.roomId,
          playerId: client.player.id,
          clientMessageId,
          text,
        })
        const message = { ...stored, senderName: client.player.name }
        broadcast(client.roomId, envelope('chat.message', client.roomId, message))
        broadcastCampaignEvent(client.campaign.id, envelope('room.activity', client.roomId, { senderId: client.player.id }))
        return
      }

      if (event.type === 'voice.join') {
        const existing = members(client.roomId)
          .filter(([other, member]) => other !== socket && member.inVoice)
          .map(([, member]) => participant(member))
        client.inVoice = true
        client.muted = false
        send(socket, envelope('voice.roster', client.roomId, { participants: existing }))
        broadcast(client.roomId, envelope('voice.participant_joined', client.roomId, { participant: participant(client) }), socket)
        return
      }

      if (event.type === 'voice.leave') {
        leaveVoice(socket, client)
        return
      }

      if (event.type === 'voice.mute_changed' && typeof event.payload.muted === 'boolean') {
        client.muted = event.payload.muted
        broadcast(client.roomId, envelope('voice.mute_changed', client.roomId, { playerId: client.player.id, muted: client.muted }))
        return
      }

      if (['voice.offer', 'voice.answer', 'voice.ice_candidate'].includes(event.type)) {
        const targetId = typeof event.payload.targetPlayerId === 'string' ? event.payload.targetPlayerId : ''
        const target = members(client.roomId).find(([, member]) => member.player.id === targetId && member.inVoice)
        if (!target || !client.inVoice) return
        const payload = event.type === 'voice.ice_candidate'
          ? { fromPlayerId: client.player.id, candidate: event.payload.candidate }
          : { fromPlayerId: client.player.id, sdp: event.payload.sdp }
        send(target[0], envelope(event.type, client.roomId, payload))
        return
      }

      if (event.type === 'ping' && Number.isInteger(event.payload.sequence)) send(socket, envelope('pong', client.roomId, event.payload))
    })

    socket.on('close', () => {
      const roomId = client.roomId
      leaveVoice(socket, client)
      clients.delete(socket)
      presenceSnapshot(roomId)
    })
  })

  return {
    store,
    async listen(port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, resolve)
      })
      return server.address().port
    },
    async close() {
      for (const socket of wss.clients) socket.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => server.close(resolve))
      store.close()
    },
  }
}
