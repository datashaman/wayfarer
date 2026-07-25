import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiInferenceSink, observeAiInference } from '../server/ai-observability.mjs'
import { createStore } from '../server/store.mjs'

test('observed inference records privacy-safe usage and duration after validation', async () => {
  const traces = []
  const ticks = [10, 34]
  const result = await observeAiInference({ campaignId: 'campaign-1', surface: 'canon', generatorVersion: 'fixture-v1', onInference: (trace) => traces.push(trace), clock: { now: () => ticks.shift() } }, async (recordUsage) => {
    recordUsage({ input_tokens: 12, output_tokens: 7 })
    return 'validated'
  })
  assert.equal(result, 'validated')
  assert.deepEqual(traces, [{ campaignId: 'campaign-1', surface: 'canon', generatorVersion: 'fixture-v1', status: 'succeeded', durationMs: 24, inputUnits: 12, outputUnits: 7, errorCategory: null }])
  assert.equal('prompt' in traces[0], false)
  assert.equal('output' in traces[0], false)
})

test('observed inference classifies errors and never masks them with recorder failure', async () => {
  const error = Object.assign(new Error('provider details'), { status: 429 })
  await assert.rejects(observeAiInference({ surface: 'knowledge', generatorVersion: 'fixture-v1', onInference: () => { throw new Error('storage unavailable') }, clock: { now: () => 1 } }, async () => { throw error }), error)
})

test('an inference sink connects server-created generators to app-owned storage', () => {
  const sink = createAiInferenceSink()
  const traces = []
  sink.record({ surface: 'canon' })
  const disconnect = sink.connect((trace) => traces.push(trace))
  sink.record({ surface: 'canon' })
  disconnect()
  sink.record({ surface: 'recap' })
  assert.deepEqual(traces, [{ surface: 'canon' }])
})

test('inference runs persist only operational metadata inside their campaign', () => {
  const store = createStore(':memory:')
  const { campaign } = store.createCampaign('Observable table', 'Mara')
  const run = store.recordAiInferenceRun({
    campaignId: campaign.id, surface: 'recap', generatorVersion: 'fixture-v1', status: 'failed',
    durationMs: 123, inputUnits: 45, outputUnits: 6, errorCategory: 'invalid_output',
  })
  assert.deepEqual(store.listAiInferenceRuns(campaign.id), [run])
  assert.equal('prompt' in run, false)
  assert.equal('output' in run, false)
  store.close()
})
