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

  const bellSquare = characterContext.world.locations[0]
  const witness = characterContext.world.npcs[0]
  const preparation = {
    title: 'The first toll', framing: 'The bell rings in Iria’s hand.', stakes: 'The town sinks.', question: 'Who cuts the rope?', characterIds: [saved.id], locationIds: [bellSquare.id], npcIds: [witness.id],
    clues: ['The rope is wet with fresh seawater.'], complications: ['The Salvagers mistake hesitation for surrender.'], sessionQuestions: ['Who rang the bell before the town returned?'], expectedRevision: null,
  }
  const prepared = store.saveScenePreparation(owner.campaign.id, owner.player.id, preparation)
  assert.equal(prepared.outcome, 'created')
  assert.deepEqual(prepared.context.preparation.locationIds, [bellSquare.id])
  assert.deepEqual(prepared.context.preparation.clues, preparation.clues)
  assert.equal(store.saveScenePreparation(owner.campaign.id, owner.player.id, preparation).outcome, 'conflict')
  const revised = store.saveScenePreparation(owner.campaign.id, owner.player.id, { ...preparation, framing: 'The bell rings in Iria’s open hand.', expectedRevision: 0 })
  assert.equal(revised.outcome, 'updated')
  assert.equal(revised.context.preparation.revision, 1)

  const started = store.startScene(owner.campaign.id, owner.player.id)
  assert.equal(started.outcome, 'started')
  assert.equal(started.message.kind, 'scene_start')
  assert.equal(started.message.scene.characters[0].name, 'Iria Voss')
  assert.equal(started.context.activeScene.locations[0].name, 'Bell Square')
  assert.equal(started.context.activeScene.npcs[0].name, 'Witness 1')
  assert.deepEqual(started.context.activeScene.clues, preparation.clues)
  assert.equal(started.context.preparation, null)
  assert.equal(store.startScene(owner.campaign.id, owner.player.id).outcome, 'active')
  const improvisedNpc = store.keepInPlayMaterial(owner.campaign.id, owner.player.id, started.context.activeScene.id, { kind: 'npc', title: 'Brother Vey', detail: 'Keeper of the submerged archive.', pressure: 'Recover the name the sea took from him.', leverage: 'A dry road through the drowned streets.', generatorVersion: 'fixture:in-play-v1' })
  assert.equal(improvisedNpc.outcome, 'kept')
  assert.equal(improvisedNpc.material.kind, 'npc')
  assert.equal(improvisedNpc.context.inPlayMaterials[0].title, 'Brother Vey')
  assert.equal(improvisedNpc.world.npcs.length, 6)
  assert.equal(improvisedNpc.world.discoveries[0].materialKind, 'npc')
  const improvisedRumour = store.keepInPlayMaterial(owner.campaign.id, owner.player.id, started.context.activeScene.id, { kind: 'rumour', title: 'The eighth toll', detail: 'The drowned whisper that the bell can ring once beyond the town’s seven nights.', pressure: 'The Tidebound will kill to learn who heard it.', leverage: 'Following the whisper reveals a sealed stair.', generatorVersion: 'fixture:in-play-v1' })
  assert.equal(improvisedRumour.world.hooks.length, 5)
  assert.equal(improvisedRumour.context.inPlayMaterials[1].kind, 'rumour')
  const possibleConsequence = store.keepInPlayMaterial(owner.campaign.id, owner.player.id, started.context.activeScene.id, { kind: 'consequence', title: 'The archive floods', detail: 'Breaking the second seal may let the black tide into the archive.', pressure: 'The water will erase every name stored below.', leverage: 'Closing the bell stair can contain it.', generatorVersion: 'fixture:in-play-v1' })
  assert.equal(possibleConsequence.world.hooks.length, 6)
  assert.equal(possibleConsequence.world.consequences.length, 0)
  const inCharacter = owner.campaign.rooms.find((room) => room.slug === 'in-character')
  assert.equal(store.listMessages(inCharacter.id).messages[0].scene.title, 'The first toll')

  const resolved = store.resolveScene(owner.campaign.id, owner.player.id, started.context.activeScene.id, 'Iria cuts the rope and the bell cracks.', [{ entityType: 'location', entityId: bellSquare.id, afterState: 'Bell Square lies open to the drowned archive below.', pressure: 'The Salvagers will arrive before dawn.' }], [{ entityType: 'npc', name: 'Sister Corda', detail: 'Keeper of the submerged archive.', tension: 'Recover the name the sea took from her.', leverage: 'A dry road through the drowned streets.' }])
  assert.equal(resolved.outcome, 'resolved')
  assert.equal(resolved.message.kind, 'scene_end')
  assert.equal(resolved.context.activeScene, null)
  assert.equal(resolved.context.scenes[0].outcome, 'Iria cuts the rope and the bell cracks.')
  assert.equal(resolved.context.worldConsequences[0].entityName, 'Bell Square')
  assert.equal(resolved.context.worldConsequences[0].beforeState, 'A flooded plaza. Lies.')
  assert.equal(store.keepInPlayMaterial(owner.campaign.id, owner.player.id, started.context.activeScene.id, { kind: 'treasure' }).outcome, 'not_found')
  const discoveredWorld = store.getCampaignWorld(owner.campaign.id)
  assert.equal(discoveredWorld.consequences[0].pressure, 'The Salvagers will arrive before dawn.')
  assert.equal(discoveredWorld.npcs.length, 7)
  assert.equal(discoveredWorld.discoveries[0].name, 'Sister Corda')
  assert.equal(discoveredWorld.discoveries[0].sourceSceneTitle, 'The first toll')
  const sisterCorda = discoveredWorld.npcs.find((npc) => npc.name === 'Sister Corda')
  assert.ok(sisterCorda)
  assert.equal(store.getCharacterCreationContext(owner.campaign.id, owner.player.id).world.npcs.some((npc) => npc.id === sisterCorda.id), true)
  assert.equal(store.resolveScene(owner.campaign.id, owner.player.id, started.context.activeScene.id, 'Again.').outcome, 'not_found')
  const changed = store.saveCharacter(owner.campaign.id, owner.player.id, {
    name: 'Iria Voss', concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find her brother.', capability: 'Knows every crossing.', complication: 'The bell knows her oath.', possession: 'A wet iron key.', belief: 'Every broken thing can answer.', secret: 'She rang the bell before.',
    factionId: characterContext.world.factions[0].id, factionConnection: 'They paid for silence.', locationId: characterContext.world.locations[0].id, locationConnection: 'She drowned there.', npcId: characterContext.world.npcs[0].id, npcConnection: 'They know what she did.', connectedCharacterId: null, characterConnection: '', generatorVersion: 'manual:character-v1',
    expectedRevision: 0, reason: 'The cracked bell answered in her brother’s voice.', sceneId: started.context.activeScene.id,
  })
  assert.equal(changed.outcome, 'updated')
  assert.equal(changed.character.revisions[0].scene.title, 'The first toll')
  assert.deepEqual(changed.character.revisions[0].changedFields, ['belief'])

  const nextPreparation = { ...preparation, title: 'Before dawn', framing: 'Hooks scrape across the square.', stakes: 'The archive will be stripped bare.', question: 'Who claims it first?', npcIds: [sisterCorda.id], expectedRevision: null }
  assert.equal(store.saveScenePreparation(owner.campaign.id, owner.player.id, nextPreparation).outcome, 'created')
  const next = store.startScene(owner.campaign.id, owner.player.id)
  assert.equal(next.context.worldEntities.some((entity) => entity.id === sisterCorda.id), true)
  const changedAgain = store.resolveScene(owner.campaign.id, owner.player.id, next.context.activeScene.id, 'Iria seals the archive behind the flood.', [{ entityType: 'location', entityId: bellSquare.id, afterState: 'Bell Square is flooded and the archive is sealed.', pressure: 'Something below keeps knocking.' }, { entityType: 'npc', entityId: sisterCorda.id, afterState: 'Sister Corda is bound to the reopened archive.', pressure: 'She needs the party to recover her stolen name.' }])
  assert.equal(changedAgain.context.worldConsequences.length, 2)
  assert.equal(changedAgain.context.worldConsequences.find((item) => item.entityId === bellSquare.id).beforeState, 'Bell Square lies open to the drowned archive below.')
  const aftermath = store.getCampaignWorld(owner.campaign.id).consequences
  assert.equal(aftermath.length, 3)
  const firstBellChange = aftermath.find((item) => item.entityId === bellSquare.id && item.status === 'resolved')
  assert.equal(firstBellChange.resolvedSceneTitle, 'Before dawn')
  store.close()
})
