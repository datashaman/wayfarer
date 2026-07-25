import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from '../server/store.mjs'

function world() {
  return {
    title: 'The Drowned Bell', premise: 'A drowned town returns.', pitch: 'Every oath comes due.',
    truths: [{ text: 'The bell remembers.' }, { text: 'The streets flood.' }, { text: 'Maps disagree.' }],
    factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'Its survivors.' }],
    locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'Lies.' }, { name: 'Tilted Inn', description: 'A refuge.', danger: 'Movement.' }, { name: 'Salt Archive', description: 'A library.', danger: 'Names.' }],
    npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A name.', leverage: 'A route.' })),
    hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A bargain.' })),
    openingCrisis: { title: 'First toll', situation: 'The bell rings.', stakes: 'The town sinks.' },
    generatorVersion: 'fixture:campaign-seed-v1',
  }
}

function character(context, values = {}) {
  return {
    name: 'Iria Voss', concept: 'A ferryman who hears the drowned.', appearance: 'Salt-white coat.',
    drive: 'Find her lost brother.', capability: 'Knows every hidden crossing.', complication: 'The bell knows her oath.',
    possession: 'A key that is always wet.', belief: 'No debt survives the truth.', secret: 'She rang the bell once before.',
    factionId: context.world.factions[0].id, factionConnection: 'They paid for her silence.',
    locationId: context.world.locations[0].id, locationConnection: 'She drowned there and returned.',
    npcId: context.world.npcs[0].id, npcConnection: 'The Witness knows what she did.',
    connectedCharacterId: null, characterConnection: '', generatorVersion: 'manual:character-v1', ...values,
  }
}

test('characters are player-owned, campaign-grounded, and keep secrets sealed', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const guest = store.joinCampaign(owner.campaign.inviteCode, 'Theo')
  store.createCampaignWorld(owner.campaign.id, owner.player.id, world())

  const ownerContext = store.getCharacterCreationContext(owner.campaign.id, owner.player.id)
  const created = store.saveCharacter(owner.campaign.id, owner.player.id, character(ownerContext))
  assert.equal(created.outcome, 'created')
  assert.equal(created.character.secret, 'She rang the bell once before.')

  const guestView = store.getCharacterCreationContext(owner.campaign.id, guest.player.id)
  assert.equal(guestView.characters[0].secret, null)
  const gmView = store.getCharacterCreationContext(owner.campaign.id, owner.player.id, { includeAllSecrets: true })
  assert.equal(gmView.characters[0].secret, 'She rang the bell once before.')

  const invalid = store.saveCharacter(owner.campaign.id, guest.player.id, character(guestView, { factionId: 'from-another-world' }))
  assert.equal(invalid.outcome, 'invalid_connection')

  const stale = store.saveCharacter(owner.campaign.id, owner.player.id, character(ownerContext, { expectedRevision: 9 }))
  assert.equal(stale.outcome, 'conflict')
  const updated = store.saveCharacter(owner.campaign.id, owner.player.id, character(ownerContext, { name: 'Iria Vale', expectedRevision: 0 }))
  assert.equal(updated.outcome, 'updated')
  assert.equal(updated.character.revision, 1)
  store.close()
})

test('in-character messages keep the character identity present at send time', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  store.createCampaignWorld(owner.campaign.id, owner.player.id, world())
  const context = store.getCharacterCreationContext(owner.campaign.id, owner.player.id)
  store.saveCharacter(owner.campaign.id, owner.player.id, character(context))
  const inCharacter = owner.campaign.rooms.find((room) => room.slug === 'in-character')
  const fireside = owner.campaign.rooms.find((room) => room.slug === 'fireside')

  store.addMessage({ roomId: inCharacter.id, playerId: owner.player.id, clientMessageId: 'ic-1', text: 'The bell is awake.' })
  store.addMessage({ roomId: fireside.id, playerId: owner.player.id, clientMessageId: 'ooc-1', text: 'That was Iria.' })
  const spoken = store.listMessages(inCharacter.id).messages[0]
  assert.equal(spoken.senderName, 'Iria Voss')
  assert.equal(spoken.playerName, 'Mara')
  assert.equal(spoken.characterName, 'Iria Voss')
  assert.equal(store.searchMessages(owner.campaign.id, 'bell is awake')[0].senderName, 'Iria Voss')
  const aside = store.listMessages(fireside.id).messages[0]
  assert.equal(aside.senderName, 'Mara')
  assert.equal(aside.playerName, 'Mara')
  assert.equal(aside.characterName, null)
  store.close()
})
