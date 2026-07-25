const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'our', 'ours', 'she', 'that', 'the', 'their', 'theirs', 'them',
  'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your', 'yours',
])

const negationWords = new Set(['never', 'no', 'not', 'without'])
const changeWords = new Set(['became', 'become', 'ceased', 'formerly', 'longer', 'now', 'previously'])

function words(value) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '').match(/[a-z0-9]+/g) ?? []
}

function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3).replace(/(.)\1$/, '$1')
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2).replace(/(.)\1$/, '$1')
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

function signals(value) {
  const tokens = words(value)
  return {
    negated: tokens.some((word) => negationWords.has(word)),
    changed: tokens.some((word) => changeWords.has(word)) || /\b(?:no longer|used to)\b/i.test(value),
  }
}

export function canonClaimTokens({ title = '', claim = '' }) {
  return new Set(words(`${title} ${claim}`).filter((word) => !stopWords.has(word)).map(stem))
}

export function canonClaimSimilarity(left, right) {
  const leftSignals = signals(`${left.title ?? ''} ${left.claim ?? ''}`)
  const rightSignals = signals(`${right.title ?? ''} ${right.claim ?? ''}`)
  if (leftSignals.negated !== rightSignals.negated || leftSignals.changed !== rightSignals.changed) return 0

  const leftTokens = canonClaimTokens(left)
  const rightTokens = canonClaimTokens(right)
  if (leftTokens.size < 2 || rightTokens.size < 2) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}

export function findNearDuplicateCanon(candidate, existing, { minimumSimilarity = 0.8 } = {}) {
  return existing
    .filter((item) => item.kind === candidate.kind)
    .map((item) => ({ item, similarity: canonClaimSimilarity(candidate, item) }))
    .filter((match) => match.similarity >= minimumSimilarity)
    .sort((left, right) => right.similarity - left.similarity)[0] ?? null
}
