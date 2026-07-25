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

export function calculateAutomationReadiness(feedback) {
  const metrics = calculateFeedbackMetrics(feedback)
  const checks = [
    { id: 'canon_sample', label: 'At least 20 reviewed canon suggestions', passed: metrics.canon.total >= 20, value: metrics.canon.total },
    { id: 'canon_precision', label: 'Canon acceptance at least 80%', passed: (metrics.canon.acceptanceRate ?? 0) >= 0.8, value: metrics.canon.acceptanceRate },
    { id: 'continuity_sample', label: 'At least 10 rated continuity threads', passed: metrics.continuity.total >= 10, value: metrics.continuity.total },
    { id: 'continuity_useful', label: 'Continuity usefulness at least 70%', passed: (metrics.continuity.usefulRate ?? 0) >= 0.7, value: metrics.continuity.usefulRate },
    { id: 'zero_leaks', label: 'No reported secret leaks', passed: metrics.continuity.secretLeak === 0, value: metrics.continuity.secretLeak },
  ]
  return { eligible: checks.every((check) => check.passed), mode: 'prepare_only', checks, metrics }
}

export function createEvaluationDashboard(feedback, evaluationRuns = []) {
  const readiness = calculateAutomationReadiness(feedback)
  const versions = [
    ...Object.entries(readiness.metrics.byGeneratorVersion.canon).map(([version, metrics]) => ({
      surface: 'canon', version, sampleSize: metrics.total, successRate: metrics.acceptanceRate,
      errorRate: metrics.rejectionRate, secretLeakRate: null,
    })),
    ...Object.entries(readiness.metrics.byGeneratorVersion.continuity).map(([version, metrics]) => ({
      surface: 'continuity', version, sampleSize: metrics.total, successRate: metrics.usefulRate,
      errorRate: metrics.incorrectRate, secretLeakRate: metrics.secretLeakRate,
    })),
  ].sort((left, right) => left.surface.localeCompare(right.surface) || left.version.localeCompare(right.version))

  const previousBySuiteAndModel = new Map()
  const runs = [...evaluationRuns].reverse().map((run) => {
    const key = `${run.suite}\u0000${run.model}`
    const passRate = ratio(run.passed, run.total)
    const previous = previousBySuiteAndModel.get(key)
    const delta = previous == null ? null : Number((passRate - previous).toFixed(4))
    previousBySuiteAndModel.set(key, passRate)
    return { ...run, passRate, delta }
  }).reverse()

  const alerts = []
  if (readiness.metrics.continuity.secretLeak > 0) alerts.push({ severity: 'critical', message: `${readiness.metrics.continuity.secretLeak} continuity ${readiness.metrics.continuity.secretLeak === 1 ? 'rating reports' : 'ratings report'} a secret leak.` })
  for (const run of runs) if (run.delta != null && run.delta < 0) alerts.push({ severity: 'warning', message: `${run.suite} dropped ${Math.abs(Math.round(run.delta * 100))} points on ${run.model} in ${run.generatorVersion}.` })

  return { readiness, versions, runs, alerts }
}
