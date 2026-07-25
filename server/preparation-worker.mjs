import { analyzeSessionInChunks, chunkSessionMessages } from './session-analysis.mjs'

const taskOrder = ['canon', 'continuity', 'recap']

export function createPreparationWorker({ store, canonExtractor = null, continuityGenerator = null, recapGenerator = null, onUpdated = () => {} }) {
  const activeRuns = new Map()
  let stopped = false

  async function runTask(run, task, context, acceptedCanon) {
    if (task === 'canon') {
      if (!canonExtractor) throw new Error('Canon extraction is not configured.')
      const priorDecisions = store.listCanonDecisionExamples(run.campaignId, 20)
      const constitution = store.getCanonConstitution(run.campaignId)
      let proposed = 0
      const artifactIds = []
      for (const messages of chunkSessionMessages(context.messages)) {
        const drafts = await canonExtractor.extract({ campaignId: run.campaignId, messages, existingCanon: acceptedCanon, priorDecisions, constitution })
        for (const draft of drafts) {
          const stored = store.createCanonProposal({ campaignId: run.campaignId, playerId: run.requestedByPlayerId, extractorVersion: canonExtractor.version, ...draft })
          if (stored.proposal?.id) artifactIds.push(stored.proposal.id)
          if (stored.outcome === 'created') proposed += 1
        }
      }
      store.markCanonScanned(run.campaignId, run.requestedByPlayerId, context.session.endSequence)
      return { proposed, artifactIds: [...new Set(artifactIds)] }
    }

    if (task === 'continuity') {
      if (!continuityGenerator) throw new Error('Continuity briefs are not configured.')
      const priorFeedback = store.listContinuityFeedbackExamples(run.campaignId, 20)
      const threads = await analyzeSessionInChunks({
        messages: context.messages,
        maximum: 3,
        keyFields: ['title', 'summary'],
        analyze: (messages) => continuityGenerator.generate({ campaignId: run.campaignId, messages, acceptedCanon, priorFeedback }),
      })
      const stored = store.createContinuityBrief({
        campaignId: run.campaignId,
        playerId: run.requestedByPlayerId,
        generatorVersion: continuityGenerator.version,
        preparationRunId: run.id,
        session: context.session,
        threads,
      })
      if (!['created', 'existing'].includes(stored.outcome)) throw new Error('Continuity citations were invalid.')
      return { id: stored.brief.id, threads: stored.brief.threads?.length ?? null }
    }

    if (!recapGenerator) throw new Error('Session recaps are not configured.')
    const drafts = []
    for (const messages of chunkSessionMessages(context.messages)) drafts.push(await recapGenerator.generate({ campaignId: run.campaignId, messages, acceptedCanon }))
    const sources = [...new Map(drafts.flatMap((draft) => draft.sources).map((source) => [source.messageId, source])).values()].slice(0, 20)
    const stored = store.createSessionRecap({
      campaignId: run.campaignId,
      playerId: run.requestedByPlayerId,
      generatorVersion: recapGenerator.version,
      preparationRunId: run.id,
      session: context.session,
      publicSummary: drafts.map((draft) => draft.publicSummary).join('\n\n').slice(0, 5_000),
      gmNotes: drafts.map((draft) => draft.gmNotes).join('\n\n').slice(0, 5_000),
      sources,
    })
    if (!['created', 'existing'].includes(stored.outcome)) throw new Error('Recap citations were invalid.')
    return { id: stored.recap.id }
  }

  async function execute(runId, campaignId) {
    let run = store.getPreparationRun(campaignId, runId)
    if (!run || stopped) return
    const context = store.getCampaignSessionMessages(campaignId, run.sessionId, 5_000)
    if (!context || context.truncated) {
      for (const task of run.tasks.filter((item) => item.status === 'queued')) {
        store.startPreparationTask(campaignId, runId, task.name)
        run = store.finishPreparationTask(campaignId, runId, task.name, { status: 'failed', error: 'The selected session cannot be prepared.' })
      }
      onUpdated(run)
      return
    }
    const acceptedCanon = store.listCanonEntries(campaignId, { includeGmOnly: true })
    for (const taskName of taskOrder) {
      if (stopped) return
      run = store.getPreparationRun(campaignId, runId)
      const task = run?.tasks.find((item) => item.name === taskName)
      if (!task || task.status !== 'queued') continue
      run = store.startPreparationTask(campaignId, runId, taskName)
      onUpdated(run)
      try {
        const result = await runTask(run, taskName, context, acceptedCanon)
        run = store.finishPreparationTask(campaignId, runId, taskName, { status: 'complete', result })
      } catch (error) {
        run = store.finishPreparationTask(campaignId, runId, taskName, { status: 'failed', error: error.message || 'Preparation failed.' })
      }
      onUpdated(run)
    }
  }

  function enqueue(run) {
    if (!run || stopped || activeRuns.has(run.id)) return activeRuns.get(run?.id) ?? null
    const promise = execute(run.id, run.campaignId).finally(() => activeRuns.delete(run.id))
    activeRuns.set(run.id, promise)
    return promise
  }

  return {
    enqueue,
    resume() {
      for (const run of store.recoverPreparationRuns()) enqueue(run)
    },
    retry(campaignId, runId) {
      const run = store.retryPreparationRun(campaignId, runId)
      if (run?.tasks.some((task) => task.status === 'queued')) enqueue(run)
      return run
    },
    async close() {
      stopped = true
      await Promise.allSettled(activeRuns.values())
    },
  }
}
