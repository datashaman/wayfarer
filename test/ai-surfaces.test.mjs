import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_SURFACES, AI_SURFACE_IDS, getAiSurface, modelForAiSurface, versionForAiSurface } from '../server/ai-surfaces.mjs'

test('the production AI registry has stable unique surface IDs and evaluation commands', () => {
  assert.deepEqual(AI_SURFACE_IDS, ['canon', 'continuity', 'contradictions', 'recap', 'knowledge', 'intent', 'house_rules', 'factions', 'campaign_seed'])
  assert.equal(new Set(AI_SURFACE_IDS).size, AI_SURFACE_IDS.length)
  assert.ok(AI_SURFACES.every((surface) => surface.evaluationCommand.startsWith('npm run eval:')))
  assert.equal(getAiSurface('house_rules').authority, 'proposal')
  assert.throws(() => getAiSurface('unknown'), /Unknown AI surface/)
})

test('surface model and version resolution follows explicit then canon then default configuration', () => {
  assert.equal(modelForAiSurface('continuity', { OPENAI_CONTINUITY_MODEL: 'continuity-model', OPENAI_CANON_MODEL: 'canon-model' }), 'continuity-model')
  assert.equal(modelForAiSurface('continuity', { OPENAI_CANON_MODEL: 'canon-model' }), 'canon-model')
  assert.equal(modelForAiSurface('continuity', {}), 'gpt-5.6-luna')
  assert.equal(versionForAiSurface('knowledge', 'model-a'), 'openai:model-a:campaign-intelligence-v1')
})
