import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from '../server/store.mjs'

function world(premise = 'A drowned town returns for seven nights.') {
  return {
    title: 'The Drowned Bell', premise, pitch: 'Every oath comes due before the seventh toll.',
    truths: [{ text: 'The bell remembers every oath.' }, { text: 'The streets flood at dawn.' }, { text: 'No map agrees.' }],
    factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths will surface.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'The town frees their enemies.' }],
    locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'The bell punishes lies.' }, { name: 'Tilted Inn', description: 'A leaning refuge.', danger: 'The foundations move.' }, { name: 'Salt Archive', description: 'A library of salt.', danger: 'Names wake their owners.' }],
    npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A true name.', leverage: 'A safe route.' })),
    hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A dangerous bargain.' })),
    openingCrisis: { title: 'The first toll', situation: 'The bell rings untouched.', stakes: 'The town sinks at the seventh toll.' },
    generatorVersion: 'fixture:campaign-seed-v1',
  }
}

test('campaign worlds persist typed playable content and reject stale revisions', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const other = store.createCampaign('Other Table', 'Theo')

  const created = store.createCampaignWorld(owner.campaign.id, owner.player.id, world())
  assert.equal(created.outcome, 'created')
  assert.equal(created.world.truths.length, 3)
  assert.equal(created.world.factions.length, 2)
  assert.equal(created.world.locations.length, 3)
  assert.equal(created.world.npcs.length, 5)
  assert.equal(created.world.hooks.length, 4)
  assert.equal(created.world.generatorVersion, 'fixture:campaign-seed-v1')
  assert.equal(store.getCampaignWorld(other.campaign.id), null)
  assert.equal(store.createCampaignWorld(owner.campaign.id, owner.player.id, world()).outcome, 'conflict')

  const firstNpcId = created.world.npcs[0].id
  const revisedWorld = { ...created.world, pitch: 'The seventh toll is tonight.', expectedRevision: 0 }
  const revised = store.updateCampaignWorld(owner.campaign.id, owner.player.id, revisedWorld)
  assert.equal(revised.outcome, 'updated')
  assert.equal(revised.world.revision, 1)
  assert.equal(revised.world.pitch, 'The seventh toll is tonight.')
  assert.equal(revised.world.npcs[0].id, firstNpcId)
  assert.equal(store.updateCampaignWorld(owner.campaign.id, owner.player.id, revisedWorld).outcome, 'conflict')
  store.close()
})
