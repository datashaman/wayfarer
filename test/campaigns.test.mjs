import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createRoomServer } from '../server/app.mjs'
import { parseIceServers } from '../server/config.mjs'

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  return { status: response.status, body: await response.json() }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function nextEvent(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2_000)
    const receive = (raw) => {
      const event = JSON.parse(String(raw))
      if (event.type !== type) return
      clearTimeout(timeout)
      socket.off('message', receive)
      resolve(event)
    }
    socket.on('message', receive)
  })
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    socket.once('close', resolve)
    socket.close()
  })
}

test('runtime voice configuration exposes the configured ICE servers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-config-'))
  const iceServers = [
    { urls: ['stun:stun.example.com:3478'] },
    { urls: ['turns:turn.example.com:5349'], username: 'wayfarer', credential: 'secret' },
  ]
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite'), iceServers })
  const port = await app.listen(0)

  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/config`)
  assert.equal(unauthorized.status, 401)

  const created = await json(`http://127.0.0.1:${port}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Long Winter', playerName: 'Mara' }),
  })
  const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).iceServers, iceServers)
})

test('invalid ICE server configuration is rejected', () => {
  assert.throws(
    () => parseIceServers('[{"urls":["https://not-an-ice-server.example"]}]'),
    /STUN or TURN URL/,
  )
})

test('a campaign creator can invite another player to the table', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-campaign-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`

  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })

  assert.equal(created.status, 201)
  assert.equal(created.body.campaign.name, 'The Ashen Coast')
  assert.match(created.body.campaign.inviteCode, /^[a-z0-9]{10}$/)
  assert.equal(created.body.player.name, 'Mara')
  assert.ok(created.body.player.token)

  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })

  assert.equal(joined.status, 201)
  assert.equal(joined.body.campaign.id, created.body.campaign.id)
  assert.equal(joined.body.player.name, 'Theo')
  assert.notEqual(joined.body.player.token, created.body.player.token)
})

test('authenticated campaign members exchange room messages', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-chat-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let mara
  let theo

  t.after(async () => {
    mara?.close()
    theo?.close()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })
  const roomId = created.body.campaign.rooms[0].id
  mara = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  theo = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)

  const maraSnapshot = nextEvent(mara, 'room.snapshot')
  mara.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await maraSnapshot

  const theoSnapshot = nextEvent(theo, 'room.snapshot')
  theo.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await theoSnapshot

  const receivedByMara = nextEvent(mara, 'chat.message')
  const receivedByTheo = nextEvent(theo, 'chat.message')
  theo.send(JSON.stringify({
    type: 'chat.send',
    id: crypto.randomUUID(),
    roomId,
    sentAt: new Date().toISOString(),
    payload: { clientMessageId: crypto.randomUUID(), text: 'The salt road is clear.' },
  }))

  const [maraEvent, theoEvent] = await Promise.all([receivedByMara, receivedByTheo])
  assert.equal(maraEvent.payload.senderName, 'Theo')
  assert.equal(theoEvent.payload.senderName, 'Theo')
  assert.equal(maraEvent.payload.text, 'The salt road is clear.')
})

test('room transcript survives a server restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-history-'))
  const databasePath = join(directory, 'table.sqlite')
  let app = createRoomServer({ databasePath })
  let port = await app.listen(0)
  let origin = `http://127.0.0.1:${port}`
  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const roomId = created.body.campaign.rooms[0].id
  let socket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)

  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) await closeSocket(socket)
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const firstSnapshot = nextEvent(socket, 'room.snapshot')
  socket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await firstSnapshot
  const delivered = nextEvent(socket, 'chat.message')
  socket.send(JSON.stringify({
    type: 'chat.send',
    id: crypto.randomUUID(),
    roomId,
    sentAt: new Date().toISOString(),
    payload: { clientMessageId: crypto.randomUUID(), text: 'Remember the drowned bell.' },
  }))
  await delivered
  await closeSocket(socket)
  await app.close()

  app = createRoomServer({ databasePath })
  port = await app.listen(0)
  socket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  const restoredSnapshot = nextEvent(socket, 'room.snapshot')
  socket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  const restored = await restoredSnapshot

  assert.deepEqual(restored.payload.messages.map((message) => message.text), ['Remember the drowned bell.'])
})
