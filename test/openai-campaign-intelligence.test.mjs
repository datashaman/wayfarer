import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAICampaignIntelligence } from '../server/openai-campaign-intelligence.mjs'

test('OpenAI campaign intelligence is strict, non-stored, and scoped for each private task', async () => {
  const requests = []
  const traces = []
  const outputs = [
    { answer: 'Ilyra keeps the light.', citations: ['canon-1'] },
    { drafts: ['I raise the lantern.'] },
    { summary: 'The court advances.', assumptions: 'The gate remains open.', proposedProgress: 2, citations: ['message-1'] },
    { title: 'Lantern test', sourceRule: 'Core test rule.', interpretation: 'Light reveals marks.', ruling: 'Gain advantage.', citations: ['message-1'] },
    { title: 'The Drowned Bell', pitch: 'A drowned town returns for seven nights.', truths: ['The bell remembers oaths.', 'The streets flood at dawn.', 'No map agrees.'], factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths surface.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'Their enemies return.' }], locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'The bell punishes lies.' }, { name: 'Tilted Inn', description: 'A leaning refuge.', danger: 'Its foundations move.' }, { name: 'Salt Archive', description: 'A library of salt.', danger: 'Names wake their owners.' }], npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A true name.', leverage: 'A safe route.' })), hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A dangerous bargain.' })), openingCrisis: { title: 'The first toll', situation: 'The bell rings untouched.', stakes: 'The town sinks at the seventh toll.' } },
    { concepts: Array.from({ length: 3 }, (_, index) => ({ name: `Wayfarer ${index + 1}`, concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find a lost sibling.', capability: 'Knows hidden crossings.', complication: 'The bell knows their oath.', possession: 'A wet iron key.', belief: 'No debt survives truth.', secret: 'They rang the bell before.', factionId: 'faction-1', factionConnection: 'They paid for silence.', locationId: 'location-1', locationConnection: 'They drowned there.', npcId: 'npc-1', npcConnection: 'The Witness knows what they did.' })) },
    { title: 'Sister Corda', detail: 'Keeper of the drowned archive.', pressure: 'She needs her stolen name before the tide turns.', leverage: 'She knows a dry road beneath the town.' },
  ]
  const client = { responses: { create: async (request) => {
    requests.push(request)
    return { output_text: JSON.stringify(outputs.shift()), usage: { input_tokens: 20, output_tokens: 5 } }
  } } }
  const intelligence = createOpenAICampaignIntelligence({ client, model: 'test-model', onInference: (trace) => traces.push(trace) })
  const canon = [{ id: 'canon-1', kind: 'fact', title: 'Ilyra', claim: 'Ilyra keeps the light.' }]

  assert.equal((await intelligence.answerKnowledge({ campaignId: 'campaign-1', question: 'Who keeps the light?', canon, priorFeedback: [{ question: 'What is hidden?', rating: 'secret_leak', generatorVersion: 'v0' }] })).citations[0], 'canon-1')
  assert.equal((await intelligence.draftIntent({ campaignId: 'campaign-1', intent: 'Signal the party.', messages: [{ text: 'The light is ours.' }], canon }))[0], 'I raise the lantern.')
  assert.equal((await intelligence.proposeFaction({ campaignId: 'campaign-1', clock: { name: 'Moth Court', goal: 'Open the gate', progress: 1, segments: 6 }, messages: [{ id: 'message-1', text: 'The western gate remains open.' }], canon })).proposedProgress, 2)
  assert.equal((await intelligence.compileHouseRule({ campaignId: 'campaign-1', messages: [{ id: 'message-1', roomName: 'rules-desk', senderName: 'Mara', text: 'We use advantage here.' }] })).citations[0], 'message-1')
  assert.equal((await intelligence.draftCampaignSeed({ campaignId: 'campaign-1', premise: 'A drowned town returns.' })).locations.length, 3)
  assert.equal((await intelligence.draftCharacterConcepts({ campaignId: 'campaign-1', world: { title: 'The Drowned Bell', factions: [{ id: 'faction-1', name: 'Salvagers' }], locations: [{ id: 'location-1', name: 'Bell Square' }], npcs: [{ id: 'npc-1', name: 'The Witness' }] } })).length, 3)
  assert.equal((await intelligence.draftInPlayMaterial({ campaignId: 'campaign-1', kind: 'npc', prompt: 'Someone waits in the archive.', scene: { title: 'The first toll' }, world: { title: 'The Drowned Bell' } })).title, 'Sister Corda')

  assert.equal(requests.length, 7)
  for (const request of requests) {
    assert.equal(request.model, 'test-model')
    assert.equal(request.store, false)
    assert.equal(request.reasoning.effort, 'none')
    assert.equal(request.text.format.strict, true)
  }
  assert.deepEqual(Object.keys(JSON.parse(requests[0].input)), ['question', 'priorVerdicts', 'readableCanon'])
  assert.equal(JSON.parse(requests[0].input).priorVerdicts[0].rating, 'secret_leak')
  assert.deepEqual(Object.keys(JSON.parse(requests[1].input)), ['intent', 'ownVoiceExamples', 'readableCanon'])
  assert.match(requests[2].instructions, /do not declare it true/i)
  assert.match(requests[3].instructions, /editable house-rule proposal/i)
  assert.match(requests[4].instructions, /pressure rather than plot/i)
  assert.match(requests[5].instructions, /exactly three distinct/i)
  assert.match(requests[6].instructions, /explicitly decide whether to keep it/i)
  assert.deepEqual(traces.map(({ surface, status, inputUnits, outputUnits }) => ({ surface, status, inputUnits, outputUnits })), [
    { surface: 'knowledge', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'intent', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'factions', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'house_rules', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'campaign_seed', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'character_concepts', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
    { surface: 'in_play_material', status: 'succeeded', inputUnits: 20, outputUnits: 5 },
  ])
})
