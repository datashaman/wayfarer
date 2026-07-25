const definitions = [
  { id: 'canon', label: 'Canon suggestions', modelEnvironmentKey: 'OPENAI_CANON_MODEL', versionTag: 'canon-v2', evaluationCommand: 'npm run eval:canon', authority: 'proposal' },
  { id: 'continuity', label: 'Continuity brief', modelEnvironmentKey: 'OPENAI_CONTINUITY_MODEL', versionTag: 'continuity-v1', evaluationCommand: 'npm run eval:continuity', authority: 'advisory' },
  { id: 'contradictions', label: 'Contradiction watch', modelEnvironmentKey: 'OPENAI_CONTRADICTION_MODEL', versionTag: 'contradiction-v1', evaluationCommand: 'npm run eval:contradictions', authority: 'advisory' },
  { id: 'recap', label: 'Session recap', modelEnvironmentKey: 'OPENAI_RECAP_MODEL', versionTag: 'recap-v1', evaluationCommand: 'npm run eval:recap', authority: 'draft' },
  { id: 'knowledge', label: 'Character knowledge', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:knowledge', authority: 'advisory' },
  { id: 'intent', label: 'Intent phrasing', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:intent', authority: 'draft' },
  { id: 'house_rules', label: 'House-rule compiler', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:house-rules', authority: 'proposal' },
  { id: 'factions', label: 'Faction clock', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:factions', authority: 'proposal' },
  { id: 'campaign_seed', label: 'Campaign opening', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:campaign-seed', authority: 'draft' },
  { id: 'character_concepts', label: 'Character concepts', modelEnvironmentKey: 'OPENAI_INTELLIGENCE_MODEL', versionTag: 'campaign-intelligence-v1', evaluationCommand: 'npm run eval:character-concepts', authority: 'draft' },
]

export const AI_SURFACES = Object.freeze(definitions.map((surface) => Object.freeze(surface)))
export const AI_SURFACE_IDS = Object.freeze(AI_SURFACES.map(({ id }) => id))

const surfacesById = new Map(AI_SURFACES.map((surface) => [surface.id, surface]))

export function getAiSurface(surfaceId) {
  const surface = surfacesById.get(surfaceId)
  if (!surface) throw new TypeError(`Unknown AI surface: ${surfaceId}`)
  return surface
}

export function modelForAiSurface(surfaceId, environment = process.env) {
  const surface = getAiSurface(surfaceId)
  return environment[surface.modelEnvironmentKey] || environment.OPENAI_CANON_MODEL || 'gpt-5.6-luna'
}

export function versionForAiSurface(surfaceId, model) {
  const surface = getAiSurface(surfaceId)
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('An AI model is required to identify a surface version.')
  return `openai:${model.trim()}:${surface.versionTag}`
}
