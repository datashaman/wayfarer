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

test('new seats receive a recovery key that is not exposed by session restore', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-seat-key-'))
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
  const restored = await json(`${origin}/api/session`, {
    headers: { authorization: `Bearer ${joined.body.player.token}` },
  })

  assert.match(created.body.recoveryCode, /^(?:[A-F0-9]{4}-){5}[A-F0-9]{4}$/)
  assert.match(joined.body.recoveryCode, /^(?:[A-F0-9]{4}-){5}[A-F0-9]{4}$/)
  assert.notEqual(created.body.recoveryCode, joined.body.recoveryCode)
  assert.equal(restored.status, 200)
  assert.equal(restored.body.recoveryCode, undefined)
})

test('active seat names are unique within a campaign', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-seat-name-'))
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
  const duplicate = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: '  mara  ' }),
  })

  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error, 'That name already has a seat in this campaign.')
})

test('a player can recover the same seat and receives new credentials', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-recover-'))
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
  const recovered = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/recover`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'theo', recoveryCode: joined.body.recoveryCode.toLowerCase() }),
  })

  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.player.id, joined.body.player.id)
  assert.equal(recovered.body.player.role, 'member')
  assert.notEqual(recovered.body.player.token, joined.body.player.token)
  assert.notEqual(recovered.body.recoveryCode, joined.body.recoveryCode)

  const oldSession = await json(`${origin}/api/session`, { headers: { authorization: `Bearer ${joined.body.player.token}` } })
  const newSession = await json(`${origin}/api/session`, { headers: { authorization: `Bearer ${recovered.body.player.token}` } })
  const reusedKey = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/recover`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo', recoveryCode: joined.body.recoveryCode }),
  })

  assert.equal(oldSession.status, 401)
  assert.equal(newSession.status, 200)
  assert.equal(reusedKey.status, 401)
})

test('recovering a seat revokes its previous live session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-recover-live-'))
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
  const closed = new Promise((resolve) => socket.once('close', (...args) => resolve(args)))

  await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/recover`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo', recoveryCode: joined.body.recoveryCode }),
  })

  assert.equal((await revoked).payload.reason, 'recovered')
  assert.equal((await closed)[0], 4003)
})

test('the owner can issue a new recovery key for an active seat', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-reset-key-'))
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
  const reset = await json(`${origin}/api/campaign/players/${joined.body.player.id}/recovery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })

  assert.equal(reset.status, 200)
  assert.match(reset.body.recoveryCode, /^(?:[A-F0-9]{4}-){5}[A-F0-9]{4}$/)
  assert.notEqual(reset.body.recoveryCode, joined.body.recoveryCode)

  const activeSession = await json(`${origin}/api/session`, { headers: { authorization: `Bearer ${joined.body.player.token}` } })
  const oldKey = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/recover`, {
    method: 'POST', body: JSON.stringify({ playerName: 'Theo', recoveryCode: joined.body.recoveryCode }),
  })
  const newKey = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/recover`, {
    method: 'POST', body: JSON.stringify({ playerName: 'Theo', recoveryCode: reset.body.recoveryCode }),
  })

  assert.equal(activeSession.status, 200)
  assert.equal(oldKey.status, 401)
  assert.equal(newKey.status, 200)
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

test('the owner can add a room to the campaign ledger', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-create-'))
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
  const added = await json(`${origin}/api/campaign/rooms`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ name: 'Lore Vault', description: 'Recovered histories and names' }),
  })

  assert.equal(added.status, 201)
  assert.deepEqual(added.body.campaign.rooms.at(-1), {
    id: added.body.campaign.rooms.at(-1).id,
    slug: 'lore-vault',
    name: 'Lore Vault',
    description: 'Recovered histories and names',
  })
})

test('the owner can rename a room and revise its purpose', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-edit-'))
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
  const room = created.body.campaign.rooms[2]
  const edited = await json(`${origin}/api/campaign/rooms/${room.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ name: 'War Council', description: 'Plans before the next march' }),
  })

  assert.equal(edited.status, 200)
  assert.deepEqual(edited.body.campaign.rooms[2], {
    ...room,
    name: 'War Council',
    description: 'Plans before the next march',
  })
})

test('the owner can reorder every active room', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-order-'))
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
  const roomIds = created.body.campaign.rooms.map((room) => room.id).reverse()
  const reordered = await json(`${origin}/api/campaign/rooms/reorder`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ roomIds }),
  })

  assert.equal(reordered.status, 200)
  assert.deepEqual(reordered.body.campaign.rooms.map((room) => room.id), roomIds)

  const incomplete = await json(`${origin}/api/campaign/rooms/reorder`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ roomIds: roomIds.slice(1) }),
  })
  assert.equal(incomplete.status, 400)
})

test('the owner can archive rooms but must leave one active room', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-archive-'))
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
  const [keptRoom, ...archivedRooms] = created.body.campaign.rooms
  let campaign = created.body.campaign
  for (const room of archivedRooms) {
    const archived = await json(`${origin}/api/campaign/rooms/${room.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${created.body.player.token}` },
    })
    assert.equal(archived.status, 200)
    campaign = archived.body.campaign
  }

  assert.deepEqual(campaign.rooms.map((room) => room.id), [keptRoom.id])

  const lastRoom = await json(`${origin}/api/campaign/rooms/${keptRoom.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  assert.equal(lastRoom.status, 400)
})

test('room changes reach every connected campaign member', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-live-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let ownerSocket
  let memberSocket

  t.after(async () => {
    ownerSocket?.terminate()
    memberSocket?.terminate()
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
  ownerSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  memberSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)
  const ownerUpdate = nextEvent(ownerSocket, 'campaign.updated')
  const memberUpdate = nextEvent(memberSocket, 'campaign.updated')

  await json(`${origin}/api/campaign/rooms`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ name: 'Lore Vault', description: 'Recovered histories and names' }),
  })

  const [ownerEvent, memberEvent] = await Promise.all([ownerUpdate, memberUpdate])
  assert.equal(ownerEvent.payload.campaign.rooms.at(-1).name, 'Lore Vault')
  assert.deepEqual(memberEvent.payload.campaign, ownerEvent.payload.campaign)
})

test('campaign members cannot perform owner mutations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-member-auth-'))
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
  const authorization = { authorization: `Bearer ${joined.body.player.token}` }
  const room = created.body.campaign.rooms[0]
  const attempts = await Promise.all([
    json(`${origin}/api/campaign/invitation`, { method: 'POST', headers: authorization }),
    json(`${origin}/api/campaign/players/${created.body.player.id}`, { method: 'DELETE', headers: authorization }),
    json(`${origin}/api/campaign/players/${created.body.player.id}/recovery`, { method: 'POST', headers: authorization }),
    json(`${origin}/api/campaign/rooms`, { method: 'POST', headers: authorization, body: JSON.stringify({ name: 'Hidden Room' }) }),
    json(`${origin}/api/campaign/rooms/${room.id}`, { method: 'PATCH', headers: authorization, body: JSON.stringify({ name: 'Renamed Room' }) }),
    json(`${origin}/api/campaign/rooms/reorder`, { method: 'POST', headers: authorization, body: JSON.stringify({ roomIds: created.body.campaign.rooms.map(({ id }) => id) }) }),
    json(`${origin}/api/campaign/rooms/${room.id}`, { method: 'DELETE', headers: authorization }),
  ])

  assert.deepEqual(attempts.map(({ status }) => status), [403, 403, 403, 403, 403, 403, 403])
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

test('room activity reaches campaign members seated in another room', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-room-activity-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let mara
  let theo

  t.after(async () => {
    mara?.terminate()
    theo?.terminate()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST', body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST', body: JSON.stringify({ playerName: 'Theo' }),
  })
  const [fireside, planning] = created.body.campaign.rooms
  mara = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  theo = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)
  const maraSnapshot = nextEvent(mara, 'room.snapshot')
  const theoSnapshot = nextEvent(theo, 'room.snapshot')
  mara.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId: fireside.id, sentAt: new Date().toISOString(), payload: {} }))
  theo.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId: planning.id, sentAt: new Date().toISOString(), payload: {} }))
  await Promise.all([maraSnapshot, theoSnapshot])
  const activity = nextEvent(theo, 'room.activity')

  mara.send(JSON.stringify({
    type: 'chat.send', id: crypto.randomUUID(), roomId: fireside.id, sentAt: new Date().toISOString(),
    payload: { clientMessageId: crypto.randomUUID(), text: 'The fire is lit.' },
  }))

  const event = await activity
  assert.equal(event.roomId, fireside.id)
  assert.equal(event.payload.senderId, created.body.player.id)
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
