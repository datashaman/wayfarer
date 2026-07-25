import { getAiSurface } from './ai-surfaces.mjs'

function nonNegativeInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function errorCategory(error) {
  const status = Number(error?.status)
  const code = typeof error?.code === 'string' ? error.code.toLocaleLowerCase() : ''
  if (status === 401 || status === 403 || code.includes('auth') || code.includes('key')) return 'authentication'
  if (status === 429 || code.includes('rate_limit')) return 'rate_limit'
  if (status === 408 || code.includes('timeout') || code.includes('abort')) return 'timeout'
  if (status >= 500 || code.includes('server') || code.includes('connection')) return 'provider'
  if (code.includes('invalid') || code.includes('citation') || code.includes('output') || code.includes('refused')) return 'invalid_output'
  return 'unknown'
}

export async function observeAiInference({ campaignId = null, surface, generatorVersion, onInference = null, clock = performance }, operation) {
  getAiSurface(surface)
  const startedAt = clock.now()
  let usage = { inputUnits: null, outputUnits: null }
  const recordUsage = (providerUsage = {}) => {
    usage = {
      inputUnits: nonNegativeInteger(providerUsage.inputUnits ?? providerUsage.input_tokens),
      outputUnits: nonNegativeInteger(providerUsage.outputUnits ?? providerUsage.output_tokens),
    }
  }
  try {
    const value = await operation(recordUsage)
    safelyNotify(onInference, {
      campaignId, surface, generatorVersion, status: 'succeeded',
      durationMs: nonNegativeInteger(clock.now() - startedAt) ?? 0, ...usage, errorCategory: null,
    })
    return value
  } catch (error) {
    safelyNotify(onInference, {
      campaignId, surface, generatorVersion, status: 'failed',
      durationMs: nonNegativeInteger(clock.now() - startedAt) ?? 0, ...usage, errorCategory: errorCategory(error),
    })
    throw error
  }
}

function safelyNotify(onInference, trace) {
  if (typeof onInference !== 'function') return
  try { onInference(trace) } catch { /* Observability must not break the campaign action. */ }
}

export function createAiInferenceSink() {
  let destination = null
  return {
    record(trace) { destination?.(trace) },
    connect(nextDestination) {
      destination = typeof nextDestination === 'function' ? nextDestination : null
      return () => { destination = null }
    },
  }
}
