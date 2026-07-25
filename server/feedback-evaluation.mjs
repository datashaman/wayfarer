export const feedbackEvaluationSchemaVersion = 'wayfarer.ai-feedback.v1'

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

function emptyCanonMetrics() {
  return { total: 0, accepted: 0, edited: 0, disputed: 0, rejected: 0 }
}

function emptyContinuityMetrics() {
  return { total: 0, useful: 0, incorrect: 0, secretLeak: 0, notUseful: 0 }
}

function finishCanonMetrics(metrics) {
  return {
    ...metrics,
    acceptanceRate: ratio(metrics.accepted + metrics.edited, metrics.total),
    editRate: ratio(metrics.edited, metrics.total),
    disputeRate: ratio(metrics.disputed, metrics.total),
    rejectionRate: ratio(metrics.rejected, metrics.total),
  }
}

function finishContinuityMetrics(metrics) {
  return {
    ...metrics,
    usefulRate: ratio(metrics.useful, metrics.total),
    incorrectRate: ratio(metrics.incorrect, metrics.total),
    secretLeakRate: ratio(metrics.secretLeak, metrics.total),
    notUsefulRate: ratio(metrics.notUseful, metrics.total),
  }
}

export function calculateFeedbackMetrics({ canon = [], continuity = [] }) {
  const canonMetrics = emptyCanonMetrics()
  const continuityMetrics = emptyContinuityMetrics()
  const canonByVersion = new Map()
  const continuityByVersion = new Map()

  for (const fixture of canon) {
    const metrics = canonByVersion.get(fixture.generatorVersion) ?? emptyCanonMetrics()
    metrics.total += 1
    canonMetrics.total += 1
    const outcome = fixture.decision.action === 'accept' ? 'accepted'
      : fixture.decision.action === 'edit_accept' ? 'edited'
        : fixture.decision.action === 'dispute' ? 'disputed' : 'rejected'
    metrics[outcome] += 1
    canonMetrics[outcome] += 1
    canonByVersion.set(fixture.generatorVersion, metrics)
  }

  for (const fixture of continuity) {
    const metrics = continuityByVersion.get(fixture.generatorVersion) ?? emptyContinuityMetrics()
    const outcome = fixture.feedback.rating === 'secret_leak' ? 'secretLeak'
      : fixture.feedback.rating === 'not_useful' ? 'notUseful' : fixture.feedback.rating
    metrics.total += 1
    metrics[outcome] += 1
    continuityMetrics.total += 1
    continuityMetrics[outcome] += 1
    continuityByVersion.set(fixture.generatorVersion, metrics)
  }

  return {
    canon: finishCanonMetrics(canonMetrics),
    continuity: finishContinuityMetrics(continuityMetrics),
    byGeneratorVersion: {
      canon: Object.fromEntries([...canonByVersion].sort().map(([version, metrics]) => [version, finishCanonMetrics(metrics)])),
      continuity: Object.fromEntries([...continuityByVersion].sort().map(([version, metrics]) => [version, finishContinuityMetrics(metrics)])),
    },
  }
}

export function createFeedbackEvaluationExport(feedback) {
  const canon = feedback.canon ?? []
  const continuity = feedback.continuity ?? []
  const deduplication = feedback.deduplication ?? []
  return {
    schemaVersion: feedbackEvaluationSchemaVersion,
    privacy: {
      intendedUse: 'local_evaluation',
      containsCampaignText: true,
      playerAndCampaignNamesExcluded: true,
    },
    fixtures: { canon, continuity },
    metrics: { ...calculateFeedbackMetrics({ canon, continuity }), deduplication },
  }
}
