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

export function createCampaignIntelligence({ version, generateKnowledgeAnswer, generateIntentDrafts, generateFactionProposal, generateHouseRule }) {
  if (!version || !generateKnowledgeAnswer || !generateIntentDrafts || !generateFactionProposal || !generateHouseRule) throw new Error('Campaign intelligence requires every generator.')
  return {
    version,
    async answerKnowledge({ question, canon, priorFeedback = [] }) {
      const output = await generateKnowledgeAnswer({ question, canon, priorFeedback })
      const answer = text(output?.answer, 2_000)
      const allowed = new Set(canon.map((entry) => entry.id))
      const citations = Array.isArray(output?.citations) ? [...new Set(output.citations)] : []
      if (!answer || !citations.length || citations.length > 10 || citations.some((id) => typeof id !== 'string' || !allowed.has(id))) {
        throw new CampaignIntelligenceError('invalid_knowledge_answer', 'The knowledge answer did not cite only readable canon.')
      }
      return { answer, citations }
    },
    async draftIntent({ intent, messages, canon }) {
      const output = await generateIntentDrafts({ intent, messages, canon })
      const drafts = Array.isArray(output?.drafts) ? output.drafts.map((item) => text(item, 500)) : []
      if (drafts.length < 1 || drafts.length > 3 || drafts.some((item) => !item)) {
        throw new CampaignIntelligenceError('invalid_intent_drafts', 'The intent studio returned invalid drafts.')
      }
      return [...new Set(drafts)]
    },
    async proposeFaction({ clock, messages, canon }) {
      const output = await generateFactionProposal({ clock, messages, canon })
      const summary = text(output?.summary, 1_000)
      const assumptions = text(output?.assumptions, 1_000)
      const proposedProgress = output?.proposedProgress
      const allowed = new Set(messages.map((message) => message.id))
      const citations = Array.isArray(output?.citations) ? [...new Set(output.citations)] : []
      if (!summary || !assumptions || !Number.isInteger(proposedProgress) || proposedProgress < 0 || proposedProgress > clock.segments || !citations.length || citations.length > 12 || citations.some((id) => typeof id !== 'string' || !allowed.has(id))) {
        throw new CampaignIntelligenceError('invalid_faction_proposal', 'The faction proposal is outside the clock boundary.')
      }
      return { summary, assumptions, proposedProgress, citations }
    },
    async compileHouseRule({ messages }) {
      const output = await generateHouseRule({ messages })
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
    },
  }
}
