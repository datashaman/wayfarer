import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from '../server/store.mjs'

const world = () => ({
  title: 'The Drowned Bell', premise: 'A drowned town returns.', pitch: 'Every oath comes due.',
  truths: [{ text: 'The bell remembers.' }, { text: 'The streets flood.' }, { text: 'Maps disagree.' }],
  factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'Its survivors.' }],
  locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'Lies.' }, { name: 'Tilted Inn', description: 'A refuge.', danger: 'Movement.' }, { name: 'Salt Archive', description: 'A library.', danger: 'Names.' }],
  npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A name.', leverage: 'A route.' })),
  hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A bargain.' })),
  openingCrisis: { title: 'First toll', situation: 'The bell rings untouched.', stakes: 'The town sinks.' }, generatorVersion: 'fixture:world-v1',
})

test('a scene crosses from saved preparation into the in-character transcript and resolves once', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  store.createCampaignWorld(owner.campaign.id, owner.player.id, world())
  const characterContext = store.getCharacterCreationContext(owner.campaign.id, owner.player.id)
  const saved = store.saveCharacter(owner.campaign.id, owner.player.id, {
    name: 'Iria Voss', concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find her brother.', capability: 'Knows every crossing.', complication: 'The bell knows her oath.', possession: 'A wet iron key.', belief: 'No debt survives truth.', secret: 'She rang the bell before.',
    factionId: characterContext.world.factions[0].id, factionConnection: 'They paid for silence.', locationId: characterContext.world.locations[0].id, locationConnection: 'She drowned there.', npcId: characterContext.world.npcs[0].id, npcConnection: 'They know what she did.', connectedCharacterId: null, characterConnection: '', generatorVersion: 'manual:character-v1',
  }).character

  const started = store.startScene(owner.campaign.id, owner.player.id, { title: 'The first toll', framing: 'The bell rings in Iria’s hand.', stakes: 'The town sinks.', question: 'Who cuts the rope?', characterIds: [saved.id] })
  assert.equal(started.outcome, 'started')
  assert.equal(started.message.kind, 'scene_start')
  assert.equal(started.message.scene.characters[0].name, 'Iria Voss')
  assert.equal(store.startScene(owner.campaign.id, owner.player.id, { title: 'Another', framing: 'Too soon.', stakes: 'None.', question: 'Why?', characterIds: [saved.id] }).outcome, 'active')
  const inCharacter = owner.campaign.rooms.find((room) => room.slug === 'in-character')
  assert.equal(store.listMessages(inCharacter.id).messages[0].scene.title, 'The first toll')

  const bellSquare = characterContext.world.locations[0]
  const resolved = store.resolveScene(owner.campaign.id, owner.player.id, started.context.activeScene.id, 'Iria cuts the rope and the bell cracks.', [{ entityType: 'location', entityId: bellSquare.id, afterState: 'Bell Square lies open to the drowned archive below.', pressure: 'The Salvagers will arrive before dawn.' }])
  assert.equal(resolved.outcome, 'resolved')
  assert.equal(resolved.message.kind, 'scene_end')
  assert.equal(resolved.context.activeScene, null)
  assert.equal(resolved.context.scenes[0].outcome, 'Iria cuts the rope and the bell cracks.')
  assert.equal(resolved.context.worldConsequences[0].entityName, 'Bell Square')
  assert.equal(resolved.context.worldConsequences[0].beforeState, 'A flooded plaza. Lies.')
  assert.equal(store.getCampaignWorld(owner.campaign.id).consequences[0].pressure, 'The Salvagers will arrive before dawn.')
  assert.equal(store.resolveScene(owner.campaign.id, owner.player.id, started.context.activeScene.id, 'Again.').outcome, 'not_found')
  const changed = store.saveCharacter(owner.campaign.id, owner.player.id, {
    name: 'Iria Voss', concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find her brother.', capability: 'Knows every crossing.', complication: 'The bell knows her oath.', possession: 'A wet iron key.', belief: 'Every broken thing can answer.', secret: 'She rang the bell before.',
    factionId: characterContext.world.factions[0].id, factionConnection: 'They paid for silence.', locationId: characterContext.world.locations[0].id, locationConnection: 'She drowned there.', npcId: characterContext.world.npcs[0].id, npcConnection: 'They know what she did.', connectedCharacterId: null, characterConnection: '', generatorVersion: 'manual:character-v1',
    expectedRevision: 0, reason: 'The cracked bell answered in her brother’s voice.', sceneId: started.context.activeScene.id,
  })
  assert.equal(changed.outcome, 'updated')
  assert.equal(changed.character.revisions[0].scene.title, 'The first toll')
  assert.deepEqual(changed.character.revisions[0].changedFields, ['belief'])

  const next = store.startScene(owner.campaign.id, owner.player.id, { title: 'Before dawn', framing: 'Hooks scrape across the square.', stakes: 'The archive will be stripped bare.', question: 'Who claims it first?', characterIds: [saved.id] })
  const changedAgain = store.resolveScene(owner.campaign.id, owner.player.id, next.context.activeScene.id, 'Iria seals the archive behind the flood.', [{ entityType: 'location', entityId: bellSquare.id, afterState: 'Bell Square is flooded and the archive is sealed.', pressure: 'Something below keeps knocking.' }])
  assert.equal(changedAgain.context.worldConsequences.length, 1)
  assert.equal(changedAgain.context.worldConsequences[0].beforeState, 'Bell Square lies open to the drowned archive below.')
  const aftermath = store.getCampaignWorld(owner.campaign.id).consequences
  assert.equal(aftermath.length, 2)
  assert.equal(aftermath[1].status, 'resolved')
  assert.equal(aftermath[1].resolvedSceneTitle, 'Before dawn')
  store.close()
})
