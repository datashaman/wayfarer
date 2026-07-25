import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAIContradictionRadar } from '../server/openai-contradiction-radar.mjs'

test('the OpenAI contradiction radar is private, strict, cited, and non-stored', async () => {
  let request
  const client = { responses: { create: async (value) => {
    request = value
    return { output_text: JSON.stringify({ findings: [{
      canonEntryId: 'canon-1', title: 'Ilyra’s role conflicts', explanation: 'The transcript directly denies the accepted role.', confidence: 0.92,
      sources: [{ messageId: 'message-1', excerpt: 'never tended a lighthouse' }],
    }] }) }
  } } }
  const radar = createOpenAIContradictionRadar({ client, model: 'test-model' })
  const findings = await radar.inspect({
    campaignId: 'campaign-1',
    messages: [{ id: 'message-1', roomName: 'fireside', senderName: 'Mara', text: 'Ilyra has never tended a lighthouse.', sentAt: new Date().toISOString() }],
    acceptedCanon: [{ id: 'canon-1', kind: 'character', title: 'Ilyra', claim: 'Ilyra tends the western lighthouse.', visibility: 'gm_only', revision: 0 }],
  })
  assert.equal(findings[0].canonEntryId, 'canon-1')
  assert.equal(request.model, 'test-model')
  assert.equal(request.store, false)
  assert.equal(request.text.format.strict, true)
  assert.match(request.instructions, /do not propose replacement canon/i)
})
