import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeSessionInChunks, chunkSessionMessages } from '../server/session-analysis.mjs'

test('long sessions are processed in overlapping bounded chunks', () => {
  const messages = Array.from({ length: 430 }, (_, index) => ({ id: String(index) }))
  const chunks = chunkSessionMessages(messages)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [200, 200, 70])
  assert.equal(chunks[1][0].id, '180')
  assert.equal(chunks[2][0].id, '360')
})

test('chunked analysis deduplicates and ranks before applying the report cap', async () => {
  const messages = Array.from({ length: 201 }, (_, index) => ({ id: String(index) }))
  let calls = 0
  const result = await analyzeSessionInChunks({
    messages, maximum: 2, keyFields: ['title'],
    analyze: async () => calls++ ? [{ title: 'Same', confidence: 0.9 }, { title: 'Second', confidence: 0.7 }] : [{ title: 'Same', confidence: 0.4 }, { title: 'Third', confidence: 0.5 }],
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.map((item) => item.title), ['Same', 'Second'])
})
