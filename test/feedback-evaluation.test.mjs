import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateAutomationReadiness, createFeedbackEvaluationExport, feedbackEvaluationSchemaVersion } from '../server/feedback-evaluation.mjs'

test('feedback evaluation reports outcomes overall and by generator version', () => {
  const evaluation = createFeedbackEvaluationExport({
    canon: [
      { generatorVersion: 'canon-v1', decision: { action: 'accept' } },
      { generatorVersion: 'canon-v1', decision: { action: 'edit_accept' } },
      { generatorVersion: 'canon-v2', decision: { action: 'reject' } },
      { generatorVersion: 'canon-v2', decision: { action: 'dispute' } },
    ],
    continuity: [
      { generatorVersion: 'continuity-v1', feedback: { rating: 'useful' } },
      { generatorVersion: 'continuity-v1', feedback: { rating: 'secret_leak' } },
      { generatorVersion: 'continuity-v2', feedback: { rating: 'incorrect' } },
      { generatorVersion: 'continuity-v2', feedback: { rating: 'not_useful' } },
    ],
  })

  assert.equal(evaluation.schemaVersion, feedbackEvaluationSchemaVersion)
  assert.deepEqual(evaluation.metrics.canon, {
    total: 4, accepted: 1, edited: 1, disputed: 1, rejected: 1,
    acceptanceRate: 0.5, editRate: 0.25, disputeRate: 0.25, rejectionRate: 0.25,
  })
  assert.deepEqual(evaluation.metrics.continuity, {
    total: 4, useful: 1, incorrect: 1, secretLeak: 1, notUseful: 1,
    usefulRate: 0.25, incorrectRate: 0.25, secretLeakRate: 0.25, notUsefulRate: 0.25,
  })
  assert.equal(evaluation.metrics.byGeneratorVersion.canon['canon-v1'].acceptanceRate, 1)
  assert.equal(evaluation.metrics.byGeneratorVersion.continuity['continuity-v2'].incorrectRate, 0.5)
  assert.deepEqual(evaluation.metrics.deduplication, [])
})

test('empty feedback produces explicit null rates instead of misleading zeroes', () => {
  const evaluation = createFeedbackEvaluationExport({ canon: [], continuity: [] })

  assert.equal(evaluation.metrics.canon.total, 0)
  assert.equal(evaluation.metrics.canon.acceptanceRate, null)
  assert.equal(evaluation.metrics.continuity.usefulRate, null)
  assert.deepEqual(evaluation.metrics.byGeneratorVersion, { canon: {}, continuity: {} })
})

test('automation readiness requires strong samples and fails on any secret leak', () => {
  const ready = calculateAutomationReadiness({
    canon: Array.from({ length: 20 }, () => ({ decision: { action: 'accept' }, generatorVersion: 'v1' })),
    continuity: Array.from({ length: 10 }, () => ({ feedback: { rating: 'useful' }, generatorVersion: 'v1' })),
  })
  assert.equal(ready.eligible, true)
  assert.equal(calculateAutomationReadiness({
    canon: Array.from({ length: 20 }, () => ({ decision: { action: 'accept' }, generatorVersion: 'v1' })),
    continuity: [...Array.from({ length: 10 }, () => ({ feedback: { rating: 'useful' }, generatorVersion: 'v1' })), { feedback: { rating: 'secret_leak' }, generatorVersion: 'v1' }],
  }).eligible, false)
})
