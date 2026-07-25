import assert from 'node:assert/strict'
import test from 'node:test'
import { canonClaimSimilarity, findNearDuplicateCanon } from '../server/canon-similarity.mjs'

test('canon similarity recognizes reordered and inflected equivalents', () => {
  const first = { kind: 'promise', title: 'Return before moonrise', claim: 'The party promised to return before moonrise.' }
  const paraphrase = { kind: 'promise', title: 'Moonrise return', claim: 'Before moonrise, the party promises they will return.' }

  assert.equal(canonClaimSimilarity(first, paraphrase), 1)
  assert.equal(findNearDuplicateCanon(paraphrase, [first]).item, first)
})

test('canon similarity preserves negations and changed world facts', () => {
  const current = { kind: 'character', title: 'Ilyra', claim: 'Ilyra keeps the western lighthouse.' }
  const ended = { kind: 'character', title: 'Ilyra', claim: 'Ilyra no longer keeps the western lighthouse.' }
  const moved = { kind: 'character', title: 'Ilyra', claim: 'Ilyra keeps the eastern lighthouse.' }

  assert.equal(canonClaimSimilarity(current, ended), 0)
  assert.ok(canonClaimSimilarity(current, moved) < 0.8)
  assert.equal(findNearDuplicateCanon(ended, [current]), null)
  assert.equal(findNearDuplicateCanon(moved, [current]), null)
})

test('canon similarity never merges different canon kinds', () => {
  const fact = { kind: 'fact', title: 'Moonrise return', claim: 'The party returns before moonrise.' }
  const promise = { kind: 'promise', title: 'Moonrise return', claim: 'The party returns before moonrise.' }

  assert.equal(findNearDuplicateCanon(promise, [fact]), null)
})
