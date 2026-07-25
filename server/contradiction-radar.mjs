import { CanonExtractionError } from './canon-extractor.mjs'
import { observeAiInference } from './ai-observability.mjs'

function requiredText(value, maximum, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maximum) throw new CanonExtractionError('invalid_output', `${field} is invalid.`)
  return text
}

export function validateContradictionFindings(rawFindings, messages, acceptedCanon, { maximum = 5 } = {}) {
  if (!Array.isArray(rawFindings)) throw new CanonExtractionError('invalid_output', 'Contradiction output must be an array.')
  if (rawFindings.length > maximum) throw new CanonExtractionError('too_many_findings', `Contradiction radar returned more than ${maximum} findings.`)
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const canonIds = new Set(acceptedCanon.map((entry) => entry.id))

  return rawFindings.map((finding) => {
    if (!finding || typeof finding !== 'object') throw new CanonExtractionError('invalid_output', 'Every contradiction finding must be an object.')
    if (typeof finding.canonEntryId !== 'string' || !canonIds.has(finding.canonEntryId)) throw new CanonExtractionError('unknown_canon', 'A contradiction cited canon outside this campaign context.')
    if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) throw new CanonExtractionError('invalid_output', 'Finding confidence is invalid.')
    if (!Array.isArray(finding.sources) || finding.sources.length === 0 || finding.sources.length > 10) throw new CanonExtractionError('citations_required', 'Every contradiction finding needs transcript citations.')
    const seen = new Set()
    const sources = finding.sources.map((source) => {
      const message = messagesById.get(source?.messageId)
      if (!message) throw new CanonExtractionError('unknown_citation', 'A contradiction cited a message outside its transcript context.')
      if (seen.has(source.messageId)) throw new CanonExtractionError('duplicate_citation', 'A contradiction cited the same message twice.')
      seen.add(source.messageId)
      const excerpt = source.excerpt === null || source.excerpt === undefined ? null : requiredText(source.excerpt, 500, 'Citation excerpt')
      if (excerpt && !message.text.toLocaleLowerCase().includes(excerpt.toLocaleLowerCase())) throw new CanonExtractionError('unsupported_excerpt', 'A contradiction excerpt does not appear in its message.')
      return { messageId: source.messageId, excerpt }
    })
    return {
      canonEntryId: finding.canonEntryId,
      title: requiredText(finding.title, 80, 'Finding title'),
      explanation: requiredText(finding.explanation, 1_000, 'Finding explanation'),
      confidence: finding.confidence,
      sources,
    }
  })
}

export function createContradictionRadar({ version, generate, maximumFindings = 5, onInference = null }) {
  const radarVersion = requiredText(version, 80, 'Radar version')
  if (typeof generate !== 'function') throw new TypeError('A contradiction generator is required.')
  return {
    version: radarVersion,
    async inspect({ campaignId, messages, acceptedCanon }) {
      if (typeof campaignId !== 'string' || !campaignId || !Array.isArray(messages) || !Array.isArray(acceptedCanon)) throw new CanonExtractionError('invalid_input', 'Campaign, transcript, and accepted canon are required.')
      return observeAiInference({ campaignId, surface: 'contradictions', generatorVersion: radarVersion, onInference }, async (recordUsage) => (
        validateContradictionFindings(await generate({ campaignId, messages, acceptedCanon, recordUsage }), messages, acceptedCanon, { maximum: maximumFindings })
      ))
    },
  }
}
