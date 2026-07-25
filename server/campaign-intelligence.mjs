import { observeAiInference } from './ai-observability.mjs'

export class CampaignIntelligenceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CampaignIntelligenceError'
    this.code = code
  }
}

function text(value, maximum) {
  const cleaned = typeof value === 'string' ? value.trim() : ''
  return cleaned && cleaned.length <= maximum ? cleaned : null
}

function objectList(value, length, fields) {
  if (!Array.isArray(value) || value.length !== length) return null
  const items = value.map((item) => Object.fromEntries(Object.entries(fields).map(([field, maximum]) => [field, text(item?.[field], maximum)])))
  return items.some((item) => Object.values(item).some((value) => !value)) ? null : items
}

export function createCampaignIntelligence({ version, generateKnowledgeAnswer, generateIntentDrafts, generateFactionProposal, generateHouseRule, generateCampaignSeed, generateCharacterConcepts, onInference = null }) {
  if (!version || !generateKnowledgeAnswer || !generateIntentDrafts || !generateFactionProposal || !generateHouseRule || !generateCampaignSeed || !generateCharacterConcepts) throw new Error('Campaign intelligence requires every generator.')
  return {
    version,
    async draftCampaignSeed({ campaignId = null, premise }) {
      return observeAiInference({ campaignId, surface: 'campaign_seed', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateCampaignSeed({ campaignId, premise, recordUsage })
        const title = text(output?.title, 120)
        const pitch = text(output?.pitch, 1_000)
        const truths = Array.isArray(output?.truths) && output.truths.length === 3 ? output.truths.map((item) => ({ text: text(item, 500) })) : null
        const factions = objectList(output?.factions, 2, { name: 120, goal: 500, opposition: 500 })
        const locations = objectList(output?.locations, 3, { name: 120, description: 1_000, danger: 500 })
        const npcs = objectList(output?.npcs, 5, { name: 120, role: 200, want: 500, leverage: 500 })
        const hooks = objectList(output?.hooks, 4, { title: 120, situation: 500 })
        const openingCrisis = objectList([output?.openingCrisis], 1, { title: 120, situation: 1_200, stakes: 800 })?.[0]
        if (!title || !pitch || !truths || truths.some((item) => !item.text) || !factions || !locations || !npcs || !hooks || !openingCrisis) {
          throw new CampaignIntelligenceError('invalid_campaign_seed', 'The campaign draft was not a complete playable opening.')
        }
        return { title, premise, pitch, truths, factions, locations, npcs, hooks, openingCrisis, generatorVersion: version }
      })
    },
    async draftCharacterConcepts({ campaignId = null, world }) {
      return observeAiInference({ campaignId, surface: 'character_concepts', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateCharacterConcepts({ campaignId, world, recordUsage })
        const concepts = objectList(output?.concepts, 3, {
          name: 80, concept: 240, appearance: 500, drive: 500, capability: 500,
          complication: 500, possession: 500, belief: 500, secret: 1_000,
          factionId: 100, factionConnection: 500, locationId: 100, locationConnection: 500,
          npcId: 100, npcConnection: 500,
        })
        const factionIds = new Set(world.factions.map((item) => item.id))
        const locationIds = new Set(world.locations.map((item) => item.id))
        const npcIds = new Set(world.npcs.map((item) => item.id))
        if (!concepts || concepts.some((item) => !factionIds.has(item.factionId) || !locationIds.has(item.locationId) || !npcIds.has(item.npcId))) {
          throw new CampaignIntelligenceError('invalid_character_concepts', 'The character concepts were not grounded in this campaign.')
        }
        return concepts.map((item) => ({ ...item, generatorVersion: version }))
      })
    },
    async answerKnowledge({ campaignId = null, question, canon, priorFeedback = [] }) {
      return observeAiInference({ campaignId, surface: 'knowledge', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateKnowledgeAnswer({ campaignId, question, canon, priorFeedback, recordUsage })
        const answer = text(output?.answer, 2_000)
        const allowed = new Set(canon.map((entry) => entry.id))
        const citations = Array.isArray(output?.citations) ? [...new Set(output.citations)] : []
        if (!answer || !citations.length || citations.length > 10 || citations.some((id) => typeof id !== 'string' || !allowed.has(id))) {
          throw new CampaignIntelligenceError('invalid_knowledge_answer', 'The knowledge answer did not cite only readable canon.')
        }
        return { answer, citations }
      })
    },
    async draftIntent({ campaignId = null, intent, messages, canon }) {
      return observeAiInference({ campaignId, surface: 'intent', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateIntentDrafts({ campaignId, intent, messages, canon, recordUsage })
        const drafts = Array.isArray(output?.drafts) ? output.drafts.map((item) => text(item, 500)) : []
        if (drafts.length < 1 || drafts.length > 3 || drafts.some((item) => !item)) {
          throw new CampaignIntelligenceError('invalid_intent_drafts', 'The intent studio returned invalid drafts.')
        }
        return [...new Set(drafts)]
      })
    },
    async proposeFaction({ campaignId = null, clock, messages, canon }) {
      return observeAiInference({ campaignId, surface: 'factions', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateFactionProposal({ campaignId, clock, messages, canon, recordUsage })
        const summary = text(output?.summary, 1_000)
        const assumptions = text(output?.assumptions, 1_000)
        const proposedProgress = output?.proposedProgress
        const allowed = new Set(messages.map((message) => message.id))
        const citations = Array.isArray(output?.citations) ? [...new Set(output.citations)] : []
        if (!summary || !assumptions || !Number.isInteger(proposedProgress) || proposedProgress < 0 || proposedProgress > clock.segments || !citations.length || citations.length > 12 || citations.some((id) => typeof id !== 'string' || !allowed.has(id))) {
          throw new CampaignIntelligenceError('invalid_faction_proposal', 'The faction proposal is outside the clock boundary.')
        }
        return { summary, assumptions, proposedProgress, citations }
      })
    },
    async compileHouseRule({ campaignId = null, messages }) {
      return observeAiInference({ campaignId, surface: 'house_rules', generatorVersion: version, onInference }, async (recordUsage) => {
        const output = await generateHouseRule({ campaignId, messages, recordUsage })
        const title = text(output?.title, 120)
        const sourceRule = text(output?.sourceRule, 1_000)
        const interpretation = text(output?.interpretation, 2_000)
        const ruling = text(output?.ruling, 2_000)
        const allowed = new Set(messages.map((message) => message.id))
        const citations = Array.isArray(output?.citations) ? [...new Set(output.citations)] : []
        if (!title || !sourceRule || !interpretation || !ruling || !citations.length || citations.length > 12 || citations.some((id) => typeof id !== 'string' || !allowed.has(id))) {
          throw new CampaignIntelligenceError('invalid_house_rule', 'The house-rule proposal must cite only selected transcript passages.')
        }
        return { title, sourceRule, interpretation, ruling, citations }
      })
    },
  }
}
