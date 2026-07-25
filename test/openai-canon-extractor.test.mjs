import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAICanonExtractor } from '../server/openai-canon-extractor.mjs'

test('the OpenAI extractor uses strict non-stored structured output', async () => {
  let request
  const client = { responses: { create: async (value) => {
    request = value
    return { output_text: JSON.stringify({ proposals: [{
      kind: 'character',
      title: 'Ilyra',
      claim: 'The lighthouse keeper is called Ilyra.',
      visibility: 'gm_only',
      confidence: 0.94,
      sources: [{ messageId: 'message-1', excerpt: 'called Ilyra' }],
    }] }) }
  } } }
  const extractor = createOpenAICanonExtractor({ client, model: 'test-model' })
  const constitution = {
    canonThreshold: 'table_consensus', playerDeclarations: 'stand_unless_challenged',
    oocPolicy: 'explicit_corrections_only', correctionPolicy: 'flag_conflicts',
    defaultVisibility: 'campaign', guidance: 'Promises spoken in character count.', revision: 2,
  }
  const drafts = await extractor.extract({
    campaignId: 'campaign-1',
    messages: [{ id: 'message-1', roomId: 'room-1', roomName: 'fireside', senderName: 'Mara', text: 'The lighthouse keeper is called Ilyra.', sentAt: new Date().toISOString() }],
    existingCanon: [],
    priorDecisions: [{ proposal: { kind: 'fact', title: 'Moon cheese', claim: 'The moon is cheese.' }, action: 'reject', reason: 'not_useful', accepted: null, extractorVersion: 'test-v0', decidedAt: new Date().toISOString() }],
    constitution,
  })

  assert.equal(drafts[0].title, 'Ilyra')
  assert.equal(request.model, 'test-model')
  assert.equal(request.store, false)
  assert.equal(request.reasoning.effort, 'none')
  assert.equal(request.text.format.type, 'json_schema')
  assert.equal(request.text.format.strict, true)
  assert.match(request.instructions, /untrusted quoted player content/)
  assert.match(request.instructions, /trusted GM-authored policy/)
  assert.equal(JSON.parse(request.input).priorHumanRulings[0].reason, 'not_useful')
  assert.deepEqual(JSON.parse(request.input).canonConstitution, constitution)
})
