const DEFAULT_CHUNK_SIZE = 200
const DEFAULT_OVERLAP = 20

export function chunkSessionMessages(messages, { size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
  if (!Array.isArray(messages) || size < 1 || overlap < 0 || overlap >= size) throw new TypeError('Invalid session chunking input.')
  if (messages.length <= size) return [messages]
  const chunks = []
  const stride = size - overlap
  for (let start = 0; start < messages.length; start += stride) {
    chunks.push(messages.slice(start, start + size))
    if (start + size >= messages.length) break
  }
  return chunks
}

function normalizedKey(item, fields) {
  return fields.map((field) => item[field] ?? '').join(' ').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export async function analyzeSessionInChunks({ messages, analyze, maximum, keyFields }) {
  const candidates = []
  for (const chunk of chunkSessionMessages(messages)) candidates.push(...await analyze(chunk))
  const unique = new Map()
  for (const candidate of candidates) {
    const key = normalizedKey(candidate, keyFields)
    const existing = unique.get(key)
    if (!existing || candidate.confidence > existing.confidence) unique.set(key, candidate)
  }
  return [...unique.values()].sort((left, right) => right.confidence - left.confidence).slice(0, maximum)
}
