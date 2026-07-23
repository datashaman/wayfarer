import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'

const root = fileURLToPath(new URL('.', import.meta.url))
const dist = join(root, 'dist')
const dev = process.argv.includes('--dev')
const port = Number(process.env.PORT ?? 8787)
const clients = new Map()
const roomMessages = new Map()

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer((request, response) => {
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
})

const wss = new WebSocketServer({ server, path: '/ws' })

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
  return { playerId: client.playerId, name: client.name, muted: client.muted }
}

function broadcast(roomId, event, except) {
  for (const [socket] of members(roomId)) if (socket !== except) send(socket, event)
}

function presenceSnapshot(roomId) {
  if (!roomId) return
  const participants = members(roomId).map(([, client]) => participant(client))
  broadcast(roomId, envelope('presence.snapshot', roomId, { participants }))
}

function leaveVoice(socket, client) {
  if (!client.inVoice || !client.roomId) return
  client.inVoice = false
  client.muted = false
  broadcast(client.roomId, envelope('voice.participant_left', client.roomId, { playerId: client.playerId }), socket)
}

wss.on('connection', (socket) => {
  const client = { playerId: '', name: '', roomId: '', inVoice: false, muted: false }
  clients.set(socket, client)

  socket.on('message', (raw) => {
    let event
    try {
      event = JSON.parse(String(raw))
    } catch {
      send(socket, envelope('error', client.roomId || 'unknown', { code: 'invalid_json', message: 'Invalid event.', retryable: false }))
      return
    }

    if (event.type === 'room.subscribe') {
      const previousRoom = client.roomId
      if (previousRoom && previousRoom !== event.roomId) leaveVoice(socket, client)
      client.playerId = String(event.payload.playerId).slice(0, 80)
      client.name = String(event.payload.name).trim().slice(0, 40) || 'Player'
      client.roomId = String(event.roomId).slice(0, 80)

      if (previousRoom && previousRoom !== client.roomId) presenceSnapshot(previousRoom)
      const roomMembers = members(client.roomId)
      send(socket, envelope('room.snapshot', client.roomId, {
        participants: roomMembers.map(([, member]) => participant(member)),
        voiceParticipants: roomMembers.filter(([, member]) => member.inVoice).map(([, member]) => participant(member)),
        messages: roomMessages.get(client.roomId) ?? [],
      }))
      presenceSnapshot(client.roomId)
      return
    }

    if (!client.roomId || event.roomId !== client.roomId) return

    if (event.type === 'chat.send') {
      const text = String(event.payload.text).trim().slice(0, 2_000)
      if (!text) return
      const message = {
        id: crypto.randomUUID(),
        clientMessageId: event.payload.clientMessageId,
        senderId: client.playerId,
        senderName: client.name,
        text,
        sentAt: new Date().toISOString(),
      }
      const history = [...(roomMessages.get(client.roomId) ?? []), message].slice(-100)
      roomMessages.set(client.roomId, history)
      broadcast(client.roomId, envelope('chat.message', client.roomId, message))
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

    if (event.type === 'voice.mute_changed') {
      client.muted = Boolean(event.payload.muted)
      broadcast(client.roomId, envelope('voice.mute_changed', client.roomId, { playerId: client.playerId, muted: client.muted }))
      return
    }

    if (['voice.offer', 'voice.answer', 'voice.ice_candidate'].includes(event.type)) {
      const target = members(client.roomId).find(([, member]) => member.playerId === event.payload.targetPlayerId)
      if (!target) return
      const payload = event.type === 'voice.ice_candidate'
        ? { fromPlayerId: client.playerId, candidate: event.payload.candidate }
        : { fromPlayerId: client.playerId, sdp: event.payload.sdp }
      send(target[0], envelope(event.type, client.roomId, payload))
      return
    }

    if (event.type === 'ping') send(socket, envelope('pong', client.roomId, event.payload))
  })

  socket.on('close', () => {
    const roomId = client.roomId
    leaveVoice(socket, client)
    clients.delete(socket)
    presenceSnapshot(roomId)
  })
})

server.listen(port, () => {
  console.log(`Wayfarer room server listening on http://127.0.0.1:${port}`)
})
