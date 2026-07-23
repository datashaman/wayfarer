const canonKinds = new Set(['fact', 'character', 'relationship', 'promise', 'event', 'question', 'contradiction', 'rule'])
const canonVisibilities = new Set(['campaign', 'gm_only'])

export class CanonExtractionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CanonExtractionError'
    this.code = code
  }
}

function requiredText(value, maximum, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maximum) throw new CanonExtractionError('invalid_output', `${field} is invalid.`)
  return text
}

export function validateCanonDrafts(rawDrafts, messages, { maximum = 5 } = {}) {
  if (!Array.isArray(rawDrafts)) throw new CanonExtractionError('invalid_output', 'Extractor output must be an array.')
  if (rawDrafts.length > maximum) throw new CanonExtractionError('too_many_proposals', `Extractor returned more than ${maximum} proposals.`)
  const messagesById = new Map(messages.map((message) => [message.id, message]))

  return rawDrafts.map((draft) => {
    if (!draft || typeof draft !== 'object') throw new CanonExtractionError('invalid_output', 'Every proposal must be an object.')
    if (!canonKinds.has(draft.kind)) throw new CanonExtractionError('invalid_output', 'Proposal kind is invalid.')
    if (!canonVisibilities.has(draft.visibility)) throw new CanonExtractionError('invalid_output', 'Proposal visibility is invalid.')
    if (typeof draft.confidence !== 'number' || draft.confidence < 0 || draft.confidence > 1) {
      throw new CanonExtractionError('invalid_output', 'Proposal confidence is invalid.')
    }
    if (!Array.isArray(draft.sources) || draft.sources.length === 0 || draft.sources.length > 10) {
      throw new CanonExtractionError('citations_required', 'Every proposal needs between one and ten citations.')
    }
    const seenSources = new Set()
    const sources = draft.sources.map((source) => {
      if (!source || typeof source.messageId !== 'string' || !messagesById.has(source.messageId)) {
        throw new CanonExtractionError('unknown_citation', 'A proposal cited a message outside the extraction window.')
      }
      if (seenSources.has(source.messageId)) throw new CanonExtractionError('duplicate_citation', 'A proposal cited the same message twice.')
      seenSources.add(source.messageId)
      const excerpt = source.excerpt === undefined || source.excerpt === null
        ? null
        : requiredText(source.excerpt, 500, 'Citation excerpt')
      const message = messagesById.get(source.messageId)
      if (excerpt && !message.text.toLocaleLowerCase().includes(excerpt.toLocaleLowerCase())) {
        throw new CanonExtractionError('unsupported_excerpt', 'A citation excerpt does not appear in its message.')
      }
      return { messageId: source.messageId, excerpt }
    })
    return {
      kind: draft.kind,
      title: requiredText(draft.title, 80, 'Proposal title'),
      claim: requiredText(draft.claim, 2_000, 'Proposal claim'),
      visibility: draft.visibility,
      confidence: draft.confidence,
      sources,
    }
  })
}

export function createCanonExtractor({ version, generate, maximumProposals = 5 }) {
  const extractorVersion = requiredText(version, 80, 'Extractor version')
  if (typeof generate !== 'function') throw new TypeError('A canon proposal generator is required.')

  return {
    version: extractorVersion,
    async extract({ campaignId, messages, existingCanon = [] }) {
      if (typeof campaignId !== 'string' || !campaignId || !Array.isArray(messages) || !Array.isArray(existingCanon)) {
        throw new CanonExtractionError('invalid_input', 'Campaign, transcript messages, and existing canon are required.')
      }
      const rawDrafts = await generate({ campaignId, messages, existingCanon })
      return validateCanonDrafts(rawDrafts, messages, { maximum: maximumProposals })
    },
  }
}
