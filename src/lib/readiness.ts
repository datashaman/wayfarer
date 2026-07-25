import type { AiReadiness } from '../types/protocol'

export function readinessRequirement(check: AiReadiness['checks'][number]) {
  if (check.passed) return 'Requirement met'
  if (check.id === 'canon_sample') return `${check.remaining} more canon ${check.remaining === 1 ? 'ruling' : 'rulings'} needed`
  if (check.id === 'canon_precision') return `${check.remaining} more positive canon ${check.remaining === 1 ? 'ruling' : 'rulings'} needed at current totals`
  if (check.id === 'continuity_sample') return `${check.remaining} more continuity ${check.remaining === 1 ? 'rating' : 'ratings'} needed`
  if (check.id === 'continuity_useful') return `${check.remaining} more useful ${check.remaining === 1 ? 'rating' : 'ratings'} needed at current totals`
  return `${check.remaining} reported secret ${check.remaining === 1 ? 'leak blocks' : 'leaks block'} preparation; revise the generator before gathering fresh evidence`
}
