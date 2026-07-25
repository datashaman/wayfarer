import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAICampaignIntelligence } from '../server/openai-campaign-intelligence.mjs'

test('OpenAI campaign intelligence is strict, non-stored, and scoped for each private task', async () => {
  const requests = []
  const outputs = [
    { answer: 'Ilyra keeps the light.', citations: ['canon-1'] },
    { drafts: ['I raise the lantern.'] },
    { summary: 'The court advances.', assumptions: 'The gate remains open.', proposedProgress: 2 },
  ]
  const client = { responses: { create: async (request) => {
    requests.push(request)
    return { output_text: JSON.stringify(outputs.shift()) }
  } } }
  const intelligence = createOpenAICampaignIntelligence({ client, model: 'test-model' })
  const canon = [{ id: 'canon-1', kind: 'fact', title: 'Ilyra', claim: 'Ilyra keeps the light.' }]

  assert.equal((await intelligence.answerKnowledge({ question: 'Who keeps the light?', canon })).citations[0], 'canon-1')
  assert.equal((await intelligence.draftIntent({ intent: 'Signal the party.', messages: [{ text: 'The light is ours.' }], canon }))[0], 'I raise the lantern.')
  assert.equal((await intelligence.proposeFaction({ clock: { name: 'Moth Court', goal: 'Open the gate', progress: 1, segments: 6 }, messages: [], canon })).proposedProgress, 2)

  assert.equal(requests.length, 3)
  for (const request of requests) {
    assert.equal(request.model, 'test-model')
    assert.equal(request.store, false)
    assert.equal(request.reasoning.effort, 'none')
    assert.equal(request.text.format.strict, true)
  }
  assert.deepEqual(Object.keys(JSON.parse(requests[0].input)), ['question', 'readableCanon'])
  assert.deepEqual(Object.keys(JSON.parse(requests[1].input)), ['intent', 'ownVoiceExamples', 'readableCanon'])
  assert.match(requests[2].instructions, /do not declare it true/i)
})
