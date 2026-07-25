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

export function createCampaignIntelligence({ version, generateKnowledgeAnswer, generateIntentDrafts, generateFactionProposal, generateHouseRule, onInference = null }) {
  if (!version || !generateKnowledgeAnswer || !generateIntentDrafts || !generateFactionProposal || !generateHouseRule) throw new Error('Campaign intelligence requires every generator.')
  return {
    version,
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
