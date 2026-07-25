import { CanonExtractionError } from './canon-extractor.mjs'

function requiredText(value, maximum, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maximum) throw new CanonExtractionError('invalid_output', `${field} is invalid.`)
  return text
}

export function validateSessionRecap(raw, messages) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CanonExtractionError('invalid_output', 'Session recap must be an object.')
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  if (!Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 20) throw new CanonExtractionError('citations_required', 'A recap needs transcript citations.')
  const sources = raw.sources.map((source) => {
    const message = messagesById.get(source?.messageId)
    if (!message) throw new CanonExtractionError('unknown_citation', 'A recap cited a message outside its session context.')
    const excerpt = source.excerpt == null ? null : requiredText(source.excerpt, 500, 'Citation excerpt')
    if (excerpt && !message.text.toLocaleLowerCase().includes(excerpt.toLocaleLowerCase())) throw new CanonExtractionError('unsupported_excerpt', 'A recap excerpt does not appear in its message.')
    return { messageId: source.messageId, excerpt }
  })
  return {
    publicSummary: requiredText(raw.publicSummary, 5_000, 'Public summary'),
    gmNotes: requiredText(raw.gmNotes, 5_000, 'GM notes'),
    sources,
  }
}

export function createSessionRecapGenerator({ version, generate }) {
  if (typeof version !== 'string' || !version.trim() || typeof generate !== 'function') throw new TypeError('A versioned session recap generator is required.')
  return {
    version: version.trim(),
    async generate({ campaignId, messages, acceptedCanon }) {
      if (!campaignId || !Array.isArray(messages) || !Array.isArray(acceptedCanon)) throw new CanonExtractionError('invalid_input', 'Session recap context is invalid.')
      return validateSessionRecap(await generate({ campaignId, messages, acceptedCanon }), messages)
    },
  }
}
