import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createRoomServer } from '../server/app.mjs'
import { parseAllowedOrigins, parseIceServers } from '../server/config.mjs'

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

test('allowed browser origins are parsed and validated', () => {
  assert.deepEqual(parseAllowedOrigins('https://table.example,https://play.example:8443'), ['https://table.example', 'https://play.example:8443'])
  assert.equal(parseAllowedOrigins(undefined), undefined)
  assert.throws(() => parseAllowedOrigins('table.example'), /HTTP origins/)
  assert.throws(() => parseAllowedOrigins('https://table.example/path'), /HTTP origins/)
})

test('health checks, exact-origin CORS, and public rate limits protect the server boundary', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-boundary-'))
  const app = createRoomServer({
    databasePath: join(directory, 'table.sqlite'),
    allowedOrigins: ['https://table.example'],
    rateLimits: { campaigns: { max: 1, windowMs: 60_000 } },
  })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`

  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const health = await fetch(`${origin}/api/health`)
  const allowed = await fetch(`${origin}/api/health`, { headers: { origin: 'https://table.example' } })
  const blocked = await fetch(`${origin}/api/health`, { headers: { origin: 'https://attacker.example' } })
  const create = () => fetch(`${origin}/api/campaigns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignName: 'The Long Road', playerName: 'Mara' }),
  })
  const first = await create()
  const limited = await create()

  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://table.example')
  assert.equal(blocked.status, 403)
  assert.equal(first.status, 201)
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
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

  const search = await json(`${origin}/api/campaign/search?q=salt%20road`, {
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  const noSession = await json(`${origin}/api/campaign/search?q=salt`)
  assert.equal(search.status, 200)
  assert.equal(search.body.results.length, 1)
  assert.equal(search.body.results[0].roomId, roomId)
  assert.equal(search.body.results[0].senderName, 'Theo')
  assert.equal(noSession.status, 401)
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

test('unread room cursors survive restarts and clear when the room is opened', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-read-cursors-'))
  const databasePath = join(directory, 'table.sqlite')
  let app = createRoomServer({ databasePath })
  let port = await app.listen(0)
  let origin = `http://127.0.0.1:${port}`
  let socket

  t.after(async () => {
    socket?.terminate()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST', body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const room = created.body.campaign.rooms[1]
  app.store.addMessage({ roomId: room.id, playerId: created.body.player.id, clientMessageId: crypto.randomUUID(), text: 'History before Theo arrived.' })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST', body: JSON.stringify({ playerName: 'Theo' }),
  })
  app.store.addMessage({ roomId: room.id, playerId: created.body.player.id, clientMessageId: crypto.randomUUID(), text: 'The old bell rang.' })

  await app.close()
  app = createRoomServer({ databasePath })
  port = await app.listen(0)
  origin = `http://127.0.0.1:${port}`

  const unread = await json(`${origin}/api/campaign/activity`, { headers: { authorization: `Bearer ${joined.body.player.token}` } })
  assert.deepEqual(unread.body.unreadRooms, { [room.id]: 1 })

  socket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)
  const snapshot = nextEvent(socket, 'room.snapshot')
  socket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId: room.id, sentAt: new Date().toISOString(), payload: {} }))
  await snapshot
  const cleared = await json(`${origin}/api/campaign/activity`, { headers: { authorization: `Bearer ${joined.body.player.token}` } })
  assert.deepEqual(cleared.body.unreadRooms, {})
})

test('message writes are idempotent and room history is cursor-paginated', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-history-pages-'))
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
    method: 'POST', body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const room = created.body.campaign.rooms[0]
  for (let index = 1; index <= 125; index += 1) {
    app.store.addMessage({ roomId: room.id, playerId: created.body.player.id, clientMessageId: `message-${index}`, text: `Ledger entry ${index}` })
  }
  const duplicate = app.store.addMessage({ roomId: room.id, playerId: created.body.player.id, clientMessageId: 'message-125', text: 'This must not replace the original.' })
  assert.equal(duplicate.inserted, false)
  assert.equal(duplicate.message.text, 'Ledger entry 125')

  socket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  const snapshotPromise = nextEvent(socket, 'room.snapshot')
  socket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId: room.id, sentAt: new Date().toISOString(), payload: {} }))
  const snapshot = await snapshotPromise
  assert.equal(snapshot.payload.messages.length, 100)
  assert.equal(snapshot.payload.messages[0].text, 'Ledger entry 26')
  assert.equal(snapshot.payload.hasMore, true)

  const older = await json(`${origin}/api/rooms/${room.id}/messages?before=${snapshot.payload.messages[0].sequence}`, {
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  assert.equal(older.status, 200)
  assert.equal(older.body.messages.length, 25)
  assert.equal(older.body.messages[0].text, 'Ledger entry 1')
  assert.equal(older.body.hasMore, false)
})

test('campaign members share durable notes with revision protection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-notes-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let ownerSocket

  t.after(async () => {
    ownerSocket?.terminate()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST', body: JSON.stringify({ campaignName: 'The Ashen Coast', playerName: 'Mara' }),
  })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST', body: JSON.stringify({ playerName: 'Theo' }),
  })
  ownerSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  const noteUpdated = nextEvent(ownerSocket, 'campaign.note_updated')
  const saved = await json(`${origin}/api/campaign/notes`, {
    method: 'PUT', headers: { authorization: `Bearer ${joined.body.player.token}` },
    body: JSON.stringify({ body: 'The lighthouse opens at moonrise.', revision: 0 }),
  })
  const restored = await json(`${origin}/api/campaign/notes`, {
    headers: { authorization: `Bearer ${created.body.player.token}` },
  })
  const stale = await json(`${origin}/api/campaign/notes`, {
    method: 'PUT', headers: { authorization: `Bearer ${created.body.player.token}` },
    body: JSON.stringify({ body: 'Overwrite the clue.', revision: 0 }),
  })

  assert.equal(saved.status, 200)
  assert.equal(saved.body.note.revision, 1)
  assert.equal(saved.body.note.updatedByName, 'Theo')
  assert.equal(restored.body.note.body, 'The lighthouse opens at moonrise.')
  assert.equal(stale.status, 409)
  assert.equal(stale.body.note.revision, 1)
  assert.equal((await noteUpdated).payload.note.body, 'The lighthouse opens at moonrise.')
})

test('canon proposals require cited campaign messages and owner review', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-canon-'))
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite') })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let ownerSocket
  let memberSocket

  t.after(async () => {
    ownerSocket?.close()
    memberSocket?.close()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Salt Road', playerName: 'Mara' }),
  })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })
  const ownerAuthorization = { authorization: `Bearer ${created.body.player.token}` }
  const memberAuthorization = { authorization: `Bearer ${joined.body.player.token}` }
  const roomId = created.body.campaign.rooms[0].id
  ownerSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  memberSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${joined.body.player.token}`)
  const snapshot = nextEvent(ownerSocket, 'room.snapshot')
  ownerSocket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await snapshot
  const memberSnapshot = nextEvent(memberSocket, 'room.snapshot')
  memberSocket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await memberSnapshot
  const messageEvent = nextEvent(ownerSocket, 'chat.message')
  ownerSocket.send(JSON.stringify({
    type: 'chat.send',
    id: crypto.randomUUID(),
    roomId,
    sentAt: new Date().toISOString(),
    payload: { clientMessageId: crypto.randomUUID(), text: 'The lighthouse keeper is called Ilyra.' },
  }))
  const message = (await messageEvent).payload

  const memberAttempt = await json(`${origin}/api/campaign/canon/proposals`, {
    method: 'POST',
    headers: memberAuthorization,
    body: JSON.stringify({}),
  })
  assert.equal(memberAttempt.status, 403)

  const createProposal = (visibility, title) => json(`${origin}/api/campaign/canon/proposals`, {
    method: 'POST',
    headers: ownerAuthorization,
    body: JSON.stringify({
      kind: 'character',
      title,
      claim: 'The lighthouse keeper is called Ilyra.',
      visibility,
      confidence: 0.91,
      extractorVersion: 'fixture-v1',
      sources: [{ messageId: message.id, excerpt: 'called Ilyra' }],
    }),
  })
  const shared = await createProposal('campaign', 'Ilyra')
  const privateProposal = await createProposal('gm_only', 'Ilyra’s secret')
  assert.equal(shared.status, 201)
  assert.equal(privateProposal.status, 201)

  const memberLedger = await json(`${origin}/api/campaign/canon`, { headers: memberAuthorization })
  assert.deepEqual(memberLedger.body.proposals.map((proposal) => proposal.title), ['Ilyra'])
  assert.equal(memberLedger.body.proposals[0].sources[0].messageId, message.id)

  const memberDecision = await json(`${origin}/api/campaign/canon/proposals/${shared.body.proposal.id}/decisions`, {
    method: 'POST',
    headers: memberAuthorization,
    body: JSON.stringify({ action: 'accept' }),
  })
  assert.equal(memberDecision.status, 403)

  const memberCanonUpdated = nextEvent(memberSocket, 'campaign.canon_updated')
  const accepted = await json(`${origin}/api/campaign/canon/proposals/${privateProposal.body.proposal.id}/decisions`, {
    method: 'POST',
    headers: ownerAuthorization,
    body: JSON.stringify({ action: 'edit_accept', title: 'Ilyra, lighthouse keeper', claim: 'Ilyra keeps the lighthouse.', visibility: 'campaign' }),
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.entries[0].title, 'Ilyra, lighthouse keeper')
  assert.equal(accepted.body.entries[0].visibility, 'campaign')
  const memberUpdate = await memberCanonUpdated
  assert.equal(memberUpdate.payload.entries[0].title, 'Ilyra, lighthouse keeper')
  assert.equal(memberUpdate.payload.entries.some((entry) => entry.visibility === 'gm_only'), false)
  assert.equal(memberUpdate.payload.entries[0].sources[0].messageId, message.id)

  const entry = accepted.body.entries[0]
  const memberRevisionUpdated = nextEvent(memberSocket, 'campaign.canon_updated')
  const superseded = await json(`${origin}/api/campaign/canon/entries/${entry.id}`, {
    method: 'PATCH',
    headers: ownerAuthorization,
    body: JSON.stringify({ action: 'supersede', title: 'Ilyra of the Glass Coast', claim: 'Ilyra now keeps the eastern lighthouse.', visibility: 'campaign', revision: 0, reason: 'The campaign advanced two years.' }),
  })
  assert.equal(superseded.status, 200)
  assert.equal(superseded.body.entry.revision, 1)
  assert.equal((await memberRevisionUpdated).payload.entries[0].title, 'Ilyra of the Glass Coast')
  const stale = await json(`${origin}/api/campaign/canon/entries/${entry.id}`, {
    method: 'PATCH',
    headers: ownerAuthorization,
    body: JSON.stringify({ action: 'revise', title: 'Stale', claim: 'Stale wording.', visibility: 'campaign', revision: 0 }),
  })
  assert.equal(stale.status, 409)
  const history = await json(`${origin}/api/campaign/canon/entries/${entry.id}/history`, { headers: memberAuthorization })
  assert.deepEqual(history.body.revisions.map((revision) => revision.action), ['superseded', 'accepted'])

  const memberRetraction = nextEvent(memberSocket, 'campaign.canon_updated')
  const retracted = await json(`${origin}/api/campaign/canon/entries/${entry.id}`, {
    method: 'DELETE',
    headers: ownerAuthorization,
    body: JSON.stringify({ revision: 1, reason: 'The table retconned Ilyra.' }),
  })
  assert.equal(retracted.status, 200)
  assert.equal(retracted.body.entry.status, 'retracted')
  assert.equal((await memberRetraction).payload.entries.length, 0)
  const repeated = await json(`${origin}/api/campaign/canon/proposals/${privateProposal.body.proposal.id}/decisions`, {
    method: 'POST',
    headers: ownerAuthorization,
    body: JSON.stringify({ action: 'reject' }),
  })
  assert.equal(repeated.status, 409)

  const anonymous = await json(`${origin}/api/campaign/canon`)
  assert.equal(anonymous.status, 401)
})

test('the owner manually extracts idempotent GM-only canon suggestions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-canon-extraction-'))
  let extractedInput
  const canonExtractor = {
    version: 'fixture-extractor-v1',
    async extract(input) {
      extractedInput = input
      return [{
        kind: 'promise',
        title: 'Return before moonrise',
        claim: 'The party promised to return before moonrise.',
        visibility: 'gm_only',
        confidence: 0.9,
        sources: [{ messageId: input.messages[0].id, excerpt: 'promised to return' }],
      }]
    },
  }
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite'), canonExtractor })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let ownerSocket

  t.after(async () => {
    ownerSocket?.close()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, {
    method: 'POST',
    body: JSON.stringify({ campaignName: 'The Moon Road', playerName: 'Mara' }),
  })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName: 'Theo' }),
  })
  const roomId = created.body.campaign.rooms[0].id
  ownerSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  const snapshot = nextEvent(ownerSocket, 'room.snapshot')
  ownerSocket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await snapshot
  const messageEvent = nextEvent(ownerSocket, 'chat.message')
  ownerSocket.send(JSON.stringify({
    type: 'chat.send', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(),
    payload: { clientMessageId: crypto.randomUUID(), text: 'We promised to return before moonrise.' },
  }))
  await messageEvent

  const memberAttempt = await json(`${origin}/api/campaign/canon/extract`, {
    method: 'POST',
    headers: { authorization: `Bearer ${joined.body.player.token}` },
  })
  assert.equal(memberAttempt.status, 403)
  const authorization = { authorization: `Bearer ${created.body.player.token}` }
  const first = await json(`${origin}/api/campaign/canon/extract`, { method: 'POST', headers: authorization })
  const repeated = await json(`${origin}/api/campaign/canon/extract`, { method: 'POST', headers: authorization })

  assert.equal(first.status, 200)
  assert.equal(first.body.proposals.length, 1)
  assert.equal(repeated.body.proposals.length, 1)
  assert.equal(first.body.proposals[0].visibility, 'gm_only')
  assert.equal(extractedInput.messages[0].text, 'We promised to return before moonrise.')
  assert.deepEqual(extractedInput.existingCanon, [])
})

test('continuity briefs are owner-private, canon-aware, cited, and rateable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-continuity-'))
  let generatorInput
  const continuityGenerator = {
    version: 'fixture-continuity-v1',
    async generate(input) {
      generatorInput = input
      return [{ title: 'Return before moonrise', summary: 'The party promised to return.', whyItMatters: 'The promise remains unresolved.', confidence: 0.9, sources: [{ messageId: input.messages[0].id, excerpt: 'promised to return' }] }]
    },
  }
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite'), continuityGenerator })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  let ownerSocket
  t.after(async () => {
    ownerSocket?.close()
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })

  const created = await json(`${origin}/api/campaigns`, { method: 'POST', body: JSON.stringify({ campaignName: 'The Moon Road', playerName: 'Mara' }) })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, { method: 'POST', body: JSON.stringify({ playerName: 'Theo' }) })
  const ownerAuthorization = { authorization: `Bearer ${created.body.player.token}` }
  const memberAuthorization = { authorization: `Bearer ${joined.body.player.token}` }
  const roomId = created.body.campaign.rooms[0].id
  ownerSocket = await openSocket(`ws://127.0.0.1:${port}/ws?token=${created.body.player.token}`)
  const snapshot = nextEvent(ownerSocket, 'room.snapshot')
  ownerSocket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
  await snapshot
  const messageEvent = nextEvent(ownerSocket, 'chat.message')
  ownerSocket.send(JSON.stringify({ type: 'chat.send', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: { clientMessageId: crypto.randomUUID(), text: 'We promised to return before moonrise.' } }))
  const message = (await messageEvent).payload
  const proposal = await json(`${origin}/api/campaign/canon/proposals`, {
    method: 'POST', headers: ownerAuthorization,
    body: JSON.stringify({ kind: 'promise', title: 'Return before moonrise', claim: 'The party promised to return.', visibility: 'gm_only', confidence: 0.9, extractorVersion: 'fixture-v1', sources: [{ messageId: message.id }] }),
  })
  await json(`${origin}/api/campaign/canon/proposals/${proposal.body.proposal.id}/decisions`, { method: 'POST', headers: ownerAuthorization, body: JSON.stringify({ action: 'accept', visibility: 'gm_only' }) })

  assert.equal((await json(`${origin}/api/campaign/continuity`, { headers: memberAuthorization })).status, 403)
  assert.equal((await json(`${origin}/api/campaign/continuity/extract`, { method: 'POST', headers: memberAuthorization })).status, 403)
  const generated = await json(`${origin}/api/campaign/continuity/extract`, { method: 'POST', headers: ownerAuthorization })
  assert.equal(generated.status, 200)
  assert.equal(generated.body.brief.threads[0].sources[0].messageId, message.id)
  assert.equal(generatorInput.acceptedCanon.length, 1)
  assert.equal(generatorInput.acceptedCanon[0].visibility, 'gm_only')

  const feedback = await json(`${origin}/api/campaign/continuity/threads/${generated.body.brief.threads[0].id}/feedback`, { method: 'POST', headers: ownerAuthorization, body: JSON.stringify({ rating: 'useful' }) })
  assert.equal(feedback.status, 200)
  assert.equal(feedback.body.brief.threads[0].feedback.rating, 'useful')
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
