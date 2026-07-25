import assert from 'node:assert/strict'
import test from 'node:test'
import { CanonExtractionError } from '../server/canon-extractor.mjs'
import { createContradictionRadar, validateContradictionFindings } from '../server/contradiction-radar.mjs'

const messages = [{ id: 'message-1', text: 'Ilyra has never tended a lighthouse.' }]
const acceptedCanon = [{ id: 'canon-1', title: 'Ilyra', claim: 'Ilyra tends the western lighthouse.' }]
const finding = {
  canonEntryId: 'canon-1', title: 'Ilyra’s role conflicts',
  explanation: 'The transcript denies the accepted role.', confidence: 0.92,
  sources: [{ messageId: 'message-1', excerpt: 'never tended a lighthouse' }],
}

test('the contradiction boundary requires both accepted canon and exact transcript citations', async () => {
  const radar = createContradictionRadar({ version: 'fixture-v1', generate: async () => [finding] })
  assert.deepEqual(await radar.inspect({ campaignId: 'campaign-1', messages, acceptedCanon }), [finding])
  assert.throws(
    () => validateContradictionFindings([{ ...finding, canonEntryId: 'invented-canon' }], messages, acceptedCanon),
    (error) => error instanceof CanonExtractionError && error.code === 'unknown_canon',
  )
  assert.throws(
    () => validateContradictionFindings([{ ...finding, sources: [{ messageId: 'message-1', excerpt: 'secretly a dragon' }] }], messages, acceptedCanon),
    (error) => error instanceof CanonExtractionError && error.code === 'unsupported_excerpt',
  )
})
