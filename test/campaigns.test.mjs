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

test('only the campaign owner can open campaign management', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-owner-'))
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
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })

  assert.equal(created.body.player.role, 'owner')
  assert.equal(joined.body.player.role, 'member')

  const ownerView = await json(`${origin}/api/campaign/manage`, {
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  const memberView = await json(`${origin}/api/campaign/manage`, {
    headers: { authorization: `Bearer ${joined.body.player.token}` },
  })

  assert.equal(ownerView.status, 200)
  assert.deepEqual(ownerView.body.players.map(({ name, role }) => ({ name, role })), [
    { name: 'Mara', role: 'owner' },
    { name: 'Theo', role: 'member' },
  ])
  assert.equal(memberView.status, 403)
})

test('the owner can replace an invitation and the old link stops working', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-invite-'))
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
  const originalCode = created.body.campaign.inviteCode
  const rotated = await json(`${origin}/api/campaign/invitation`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })

  assert.equal(rotated.status, 200)
  assert.match(rotated.body.campaign.inviteCode, /^[a-z0-9]{10}$/)
  assert.notEqual(rotated.body.campaign.inviteCode, originalCode)

  const oldLink = await json(`${origin}/api/invitations/${originalCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })
  const newLink = await json(`${origin}/api/invitations/${rotated.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })

  assert.equal(oldLink.status, 404)
  assert.equal(newLink.status, 201)
})

test('the owner can remove a player without removing the owner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-remove-'))
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
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })

  const removed = await json(`${origin}/api/campaign/players/${joined.body.player.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  const removedSession = await json(`${origin}/api/session`, {
    headers: { authorization: `Bearer ${joined.body.player.token}` },
  })
  const removeOwner = await json(`${origin}/api/campaign/players/${created.body.player.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })

  assert.equal(removed.status, 200)
  assert.deepEqual(removed.body.players.map((player) => player.name), ['Mara'])
  assert.equal(removedSession.status, 401)
  assert.equal(removeOwner.status, 400)
})

test('removing a seated player revokes their live session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-revoke-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let socket

  t.after(async () => {
    socket?.terminate()
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
  socket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)
  const revoked = nextEvent(socket, 'session.revoked')

  await json(`${origin}/api/campaign/players/${joined.body.player.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })

  assert.equal((await revoked).payload.reason, 'removed')
  const [code] = await new Promise((resolve) => socket.once('close', (...args) => resolve(args)))
  assert.equal(code, 4003)
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
