import assert from 'node:assert/strict'
import test from 'node:test'
import { CanonExtractionError, createCanonExtractor, validateCanonDrafts } from '../server/canon-extractor.mjs'

const messages = [
  { id: 'message-1', text: 'The lighthouse keeper is called Ilyra.' },
  { id: 'message-2', text: 'We promised to return before moonrise.' },
]

const validDraft = {
  kind: 'character',
  title: 'Ilyra',
  claim: 'The lighthouse keeper is called Ilyra.',
  visibility: 'gm_only',
  confidence: 0.94,
  sources: [{ messageId: 'message-1', excerpt: 'called Ilyra' }],
}

test('the extraction boundary returns only constrained, cited proposal drafts', async () => {
  const extractor = createCanonExtractor({
    version: 'fixture-v1',
    generate: async ({ campaignId, existingCanon }) => {
      assert.equal(campaignId, 'campaign-1')
      assert.deepEqual(existingCanon, [])
      return [validDraft]
    },
  })

  assert.equal(extractor.version, 'fixture-v1')
  assert.deepEqual(await extractor.extract({ campaignId: 'campaign-1', messages }), [validDraft])
})

test('the extraction boundary rejects invented citations and excerpts', () => {
  assert.throws(
    () => validateCanonDrafts([{ ...validDraft, sources: [{ messageId: 'invented-message' }] }], messages),
    (error) => error instanceof CanonExtractionError && error.code === 'unknown_citation',
  )
  assert.throws(
    () => validateCanonDrafts([{ ...validDraft, sources: [{ messageId: 'message-1', excerpt: 'a dragon said this' }] }], messages),
    (error) => error instanceof CanonExtractionError && error.code === 'unsupported_excerpt',
  )
})

test('the extraction boundary caps proposal volume and validates every field', () => {
  assert.throws(
    () => validateCanonDrafts(Array.from({ length: 6 }, () => validDraft), messages),
    (error) => error instanceof CanonExtractionError && error.code === 'too_many_proposals',
  )
  assert.throws(
    () => validateCanonDrafts([{ ...validDraft, confidence: 2 }], messages),
    (error) => error instanceof CanonExtractionError && error.code === 'invalid_output',
  )
  assert.throws(
    () => validateCanonDrafts([{ ...validDraft, sources: [] }], messages),
    (error) => error instanceof CanonExtractionError && error.code === 'citations_required',
  )
})
