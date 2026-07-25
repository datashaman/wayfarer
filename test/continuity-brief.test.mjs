import assert from 'node:assert/strict'
import test from 'node:test'
import { CanonExtractionError } from '../server/canon-extractor.mjs'
import { createContinuityBriefGenerator, validateContinuityThreads } from '../server/continuity-brief.mjs'
import { createOpenAIContinuityBriefGenerator } from '../server/openai-continuity-brief.mjs'

const messages = [{ id: 'message-1', roomName: 'fireside', senderName: 'Mara', text: 'We promised to return before moonrise.', sentAt: new Date().toISOString() }]
const thread = { title: 'Promise at moonrise', summary: 'The party still owes a return visit.', whyItMatters: 'The promise remains unresolved.', confidence: 0.9, sources: [{ messageId: 'message-1', excerpt: 'promised to return' }] }

test('continuity threads are capped and require exact transcript citations', () => {
  assert.deepEqual(validateContinuityThreads([thread], messages), [thread])
  assert.throws(() => validateContinuityThreads([{ ...thread, sources: [{ messageId: 'invented' }] }], messages), (error) => error instanceof CanonExtractionError && error.code === 'unknown_citation')
  assert.throws(() => validateContinuityThreads(Array.from({ length: 4 }, () => thread), messages), (error) => error instanceof CanonExtractionError && error.code === 'too_many_threads')
})

test('the model-neutral continuity boundary validates generated output', async () => {
  const generator = createContinuityBriefGenerator({ version: 'fixture-v1', generate: async () => [thread] })
  assert.deepEqual(await generator.generate({ campaignId: 'campaign-1', messages, acceptedCanon: [] }), [thread])
})

test('the OpenAI continuity generator uses private strict structured output', async () => {
  let request
  const client = { responses: { create: async (value) => {
    request = value
    return { output_text: JSON.stringify({ threads: [thread] }) }
  } } }
  const generator = createOpenAIContinuityBriefGenerator({ client, model: 'test-model' })
  const result = await generator.generate({ campaignId: 'campaign-1', messages, acceptedCanon: [], priorFeedback: [{ rating: 'useful' }] })
  assert.equal(result[0].title, thread.title)
  assert.equal(request.store, false)
  assert.equal(request.reasoning.effort, 'none')
  assert.equal(request.text.format.strict, true)
  assert.match(request.instructions, /untrusted quoted game content/i)
  assert.match(request.instructions, /GM-only/i)
  assert.deepEqual(JSON.parse(request.input).priorFeedback, [{ rating: 'useful' }])
})
