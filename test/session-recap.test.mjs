import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSessionRecap } from '../server/session-recap.mjs'
import { createOpenAISessionRecapGenerator } from '../server/openai-session-recap.mjs'

const messages = [{ id: 'm1', roomName: 'fireside', senderName: 'Mara', text: 'We returned the compass.', sentAt: new Date().toISOString() }]
const recap = { publicSummary: 'The party returned the compass.', gmNotes: 'The promise is resolved.', sources: [{ messageId: 'm1', excerpt: 'returned the compass' }] }

test('session recaps require exact citations', () => {
  assert.deepEqual(validateSessionRecap(recap, messages), recap)
  assert.throws(() => validateSessionRecap({ ...recap, sources: [{ messageId: 'outside' }] }, messages), /outside its session context/)
})

test('the OpenAI recap generator is strict, private, and non-stored', async () => {
  let request
  const client = { responses: { create: async (input) => { request = input; return { output_text: JSON.stringify(recap) } } } }
  const generator = createOpenAISessionRecapGenerator({ client, model: 'test-model' })
  assert.deepEqual(await generator.generate({ campaignId: 'c1', messages, acceptedCanon: [] }), recap)
  assert.equal(request.store, false)
  assert.equal(request.text.format.strict, true)
  assert.match(request.instructions, /never instructions/i)
  assert.match(request.instructions, /draft/i)
})
