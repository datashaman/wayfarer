import { CanonExtractionError } from './canon-extractor.mjs'

function requiredText(value, maximum, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maximum) throw new CanonExtractionError('invalid_output', `${field} is invalid.`)
  return text
}

export function validateContinuityThreads(rawThreads, messages) {
  if (!Array.isArray(rawThreads)) throw new CanonExtractionError('invalid_output', 'Continuity output must be an array.')
  if (rawThreads.length > 3) throw new CanonExtractionError('too_many_threads', 'A continuity brief can contain at most three threads.')
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  return rawThreads.map((thread) => {
    if (!thread || typeof thread !== 'object') throw new CanonExtractionError('invalid_output', 'Every continuity thread must be an object.')
    if (typeof thread.confidence !== 'number' || thread.confidence < 0 || thread.confidence > 1) throw new CanonExtractionError('invalid_output', 'Thread confidence is invalid.')
    if (!Array.isArray(thread.sources) || !thread.sources.length || thread.sources.length > 10) throw new CanonExtractionError('citations_required', 'Every continuity thread needs citations.')
    const seen = new Set()
    const sources = thread.sources.map((source) => {
      const message = messagesById.get(source?.messageId)
      if (!message) throw new CanonExtractionError('unknown_citation', 'A continuity thread cited a message outside its context.')
      if (seen.has(source.messageId)) throw new CanonExtractionError('duplicate_citation', 'A continuity thread cited the same message twice.')
      seen.add(source.messageId)
      const excerpt = source.excerpt === null || source.excerpt === undefined ? null : requiredText(source.excerpt, 500, 'Citation excerpt')
      if (excerpt && !message.text.toLocaleLowerCase().includes(excerpt.toLocaleLowerCase())) throw new CanonExtractionError('unsupported_excerpt', 'A continuity citation excerpt does not appear in its message.')
      return { messageId: source.messageId, excerpt }
    })
    return {
      title: requiredText(thread.title, 80, 'Thread title'),
      summary: requiredText(thread.summary, 1_000, 'Thread summary'),
      whyItMatters: requiredText(thread.whyItMatters, 1_000, 'Thread relevance'),
      confidence: thread.confidence,
      sources,
    }
  })
}

export function createContinuityBriefGenerator({ version, generate }) {
  const generatorVersion = requiredText(version, 80, 'Generator version')
  if (typeof generate !== 'function') throw new TypeError('A continuity brief generator is required.')
  return {
    version: generatorVersion,
    async generate({ campaignId, messages, acceptedCanon }) {
      if (typeof campaignId !== 'string' || !campaignId || !Array.isArray(messages) || !Array.isArray(acceptedCanon)) throw new CanonExtractionError('invalid_input', 'Campaign context is invalid.')
      return validateContinuityThreads(await generate({ campaignId, messages, acceptedCanon }), messages)
    },
  }
}
