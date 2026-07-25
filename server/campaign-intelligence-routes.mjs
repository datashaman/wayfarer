import { analyzeSessionInChunks, chunkSessionMessages } from './session-analysis.mjs'
import { calculateAutomationReadiness } from './feedback-evaluation.mjs'

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 65_536) throw new Error('request_too_large')
  }
  return JSON.parse(body || '{}')
}

function clean(value, maximum) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result && result.length <= maximum ? result : null
}

export function createCampaignIntelligenceRoutes({ store, intelligence = null, canonExtractor = null, continuityGenerator = null, recapGenerator = null }) {
  const activeRuns = new Set()

  function overview(campaignId) {
    return {
      settings: store.getIntelligenceSettings(campaignId),
      readiness: calculateAutomationReadiness(store.exportAiFeedback(campaignId)),
      preparationRuns: store.listPreparationRuns(campaignId),
      houseRules: store.listHouseRules(campaignId),
      factionClocks: store.listFactionClocks(campaignId),
      spotlightParticipants: store.getSpotlightParticipants(campaignId),
    }
  }

  async function executePreparation(campaignId, playerId, run) {
    if (activeRuns.has(run.id)) return
    activeRuns.add(run.id)
    store.finishPreparationRun(campaignId, run.id, { status: 'running' })
    try {
      const context = store.getCampaignSessionMessages(campaignId, run.sessionId, 5_000)
      if (!context || context.truncated) throw new Error('The selected session cannot be prepared.')
      const acceptedCanon = store.listCanonEntries(campaignId, { includeGmOnly: true })
      const result = {}
      if (run.tasks.canon) {
        if (!canonExtractor) throw new Error('Canon extraction is not configured.')
        const priorDecisions = store.listCanonDecisionExamples(campaignId, 20)
        const constitution = store.getCanonConstitution(campaignId)
        let proposed = 0
        for (const messages of chunkSessionMessages(context.messages)) {
          const drafts = await canonExtractor.extract({ campaignId, messages, existingCanon: acceptedCanon, priorDecisions, constitution })
          for (const draft of drafts) if (store.createCanonProposal({ campaignId, playerId, extractorVersion: canonExtractor.version, ...draft }).outcome === 'created') proposed += 1
        }
        store.markCanonScanned(campaignId, playerId, context.session.endSequence)
        result.canon = { proposed }
      }
      if (run.tasks.continuity) {
        if (!continuityGenerator) throw new Error('Continuity briefs are not configured.')
        const priorFeedback = store.listContinuityFeedbackExamples(campaignId, 20)
        const threads = await analyzeSessionInChunks({
          messages: context.messages, maximum: 3, keyFields: ['title', 'summary'],
          analyze: (messages) => continuityGenerator.generate({ campaignId, messages, acceptedCanon, priorFeedback }),
        })
        const stored = store.createContinuityBrief({ campaignId, playerId, generatorVersion: continuityGenerator.version, session: context.session, threads })
        if (stored.outcome !== 'created') throw new Error('Continuity citations were invalid.')
        result.continuity = { threads: stored.brief.threads.length }
      }
      if (run.tasks.recap) {
        if (!recapGenerator) throw new Error('Session recaps are not configured.')
        const drafts = []
        for (const messages of chunkSessionMessages(context.messages)) drafts.push(await recapGenerator.generate({ campaignId, messages, acceptedCanon }))
        const sources = [...new Map(drafts.flatMap((draft) => draft.sources).map((source) => [source.messageId, source])).values()].slice(0, 20)
        const stored = store.createSessionRecap({
          campaignId, playerId, generatorVersion: recapGenerator.version, session: context.session,
          publicSummary: drafts.map((draft) => draft.publicSummary).join('\n\n').slice(0, 5_000),
          gmNotes: drafts.map((draft) => draft.gmNotes).join('\n\n').slice(0, 5_000), sources,
        })
        if (stored.outcome !== 'created') throw new Error('Recap citations were invalid.')
        result.recap = { id: stored.recap.id }
      }
      store.finishPreparationRun(campaignId, run.id, { status: 'complete', result })
    } catch (error) {
      store.finishPreparationRun(campaignId, run.id, { status: 'failed', error: error.message || 'Preparation failed.' })
    } finally {
      activeRuns.delete(run.id)
    }
  }

  function queuePreparation(campaignId, playerId, sessionId) {
    const readiness = calculateAutomationReadiness(store.exportAiFeedback(campaignId))
    if (!readiness.eligible) return { outcome: 'not_eligible', readiness }
    const settings = store.getIntelligenceSettings(campaignId)
    const tasks = settings.tasks
    if (!Object.values(tasks).some(Boolean)) return { outcome: 'no_tasks' }
    const session = store.listCampaignSessions(campaignId).find((item) => item.id === sessionId && item.status === 'closed')
    if (!session) return { outcome: 'not_found' }
    const run = store.queuePreparationRun(campaignId, sessionId, playerId, tasks)
    void executePreparation(campaignId, playerId, run)
    return { outcome: 'queued', run }
  }

  return {
    sessionClosed(campaignId, playerId, sessionId) {
      const settings = store.getIntelligenceSettings(campaignId)
      if (!settings?.autoPrepare) return null
      return queuePreparation(campaignId, playerId, sessionId)
    },

    async handle(request, response, requestSession) {
      if (!request.url?.startsWith('/api/campaign/intelligence')) return false
      if (!requestSession) {
        sendJson(response, 401, { error: 'Session not found.' })
        return true
      }
      const campaignId = requestSession.campaign.id
      const playerId = requestSession.player.id
      const isGm = requestSession.player.knowledgeRole === 'gm'

      if (request.method === 'GET' && request.url === '/api/campaign/intelligence') {
        sendJson(response, isGm ? 200 : 403, isGm ? overview(campaignId) : { error: 'Campaign intelligence controls are private to GMs.' })
        return true
      }
      if (request.method === 'PUT' && request.url === '/api/campaign/intelligence/settings') {
        if (!isGm) { sendJson(response, 403, { error: 'Only a GM can schedule preparation.' }); return true }
        const body = await readJson(request)
        const tasks = body.tasks
        if (typeof body.autoPrepare !== 'boolean' || !tasks || ['canon', 'continuity', 'recap'].some((task) => typeof tasks[task] !== 'boolean')) {
          sendJson(response, 400, { error: 'Preparation settings are invalid.' }); return true
        }
        const readiness = calculateAutomationReadiness(store.exportAiFeedback(campaignId))
        if (body.autoPrepare && !readiness.eligible) { sendJson(response, 409, { error: 'This campaign has not passed its preparation gates.', readiness }); return true }
        store.updateIntelligenceSettings(campaignId, playerId, { autoPrepare: body.autoPrepare, tasks })
        sendJson(response, 200, overview(campaignId)); return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/preparation') {
        if (!isGm) { sendJson(response, 403, { error: 'Only a GM can schedule preparation.' }); return true }
        const body = await readJson(request)
        const sessionId = clean(body.sessionId, 100)
        if (!sessionId) { sendJson(response, 400, { error: 'Choose a closed session.' }); return true }
        const result = queuePreparation(campaignId, playerId, sessionId)
        const status = result.outcome === 'queued' ? 202 : result.outcome === 'not_eligible' ? 409 : 400
        sendJson(response, status, result.outcome === 'queued' ? { run: result.run } : { error: result.outcome === 'not_eligible' ? 'This campaign has not passed its preparation gates.' : 'The session cannot be prepared.', ...result })
        return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/knowledge') {
        if (!intelligence) { sendJson(response, 503, { error: 'Perspective memory is not configured.' }); return true }
        const body = await readJson(request)
        const question = clean(body.question, 500)
        const targetPlayerId = isGm && typeof body.playerId === 'string' ? body.playerId : playerId
        if (!question || (!isGm && body.playerId && body.playerId !== playerId)) { sendJson(response, 400, { error: 'Knowledge query is invalid.' }); return true }
        const knowledge = store.getCharacterKnowledge(campaignId, targetPlayerId)
        if (!knowledge) { sendJson(response, 404, { error: 'Player not found.' }); return true }
        if (!knowledge.entries.length) { sendJson(response, 400, { error: 'This character has no readable canon yet.' }); return true }
        const answer = await intelligence.answerKnowledge({ question, canon: knowledge.entries })
        sendJson(response, 200, { answer: answer.answer, citations: answer.citations.map((id) => knowledge.entries.find((entry) => entry.id === id)) })
        return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/intent') {
        if (!intelligence) { sendJson(response, 503, { error: 'The intent studio is not configured.' }); return true }
        const body = await readJson(request)
        const intent = clean(body.intent, 500)
        if (!intent) { sendJson(response, 400, { error: 'Describe what your character intends.' }); return true }
        const canon = store.getCharacterKnowledge(campaignId, playerId)?.entries ?? []
        const messages = store.listPlayerMessages(campaignId, playerId, 20)
        const drafts = await intelligence.draftIntent({ intent, messages, canon })
        sendJson(response, 200, { drafts, generatorVersion: intelligence.version })
        return true
      }
      if (request.method === 'PUT' && request.url === '/api/campaign/intelligence/spotlight/consent') {
        const body = await readJson(request)
        if (typeof body.enabled !== 'boolean') { sendJson(response, 400, { error: 'Spotlight consent is invalid.' }); return true }
        sendJson(response, 200, { consent: store.setSpotlightConsent(playerId, body.enabled) }); return true
      }
      if (request.method === 'GET' && request.url === '/api/campaign/intelligence/spotlight/consent') {
        const participant = store.getSpotlightParticipants(campaignId).find((item) => item.id === playerId)
        sendJson(response, 200, { consent: { enabled: participant?.enabled ?? false } }); return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/spotlight/report') {
        if (!isGm) { sendJson(response, 403, { error: 'Spotlight reports are private to GMs.' }); return true }
        const body = await readJson(request)
        const report = typeof body.sessionId === 'string' ? store.createSpotlightReport(campaignId, body.sessionId) : null
        sendJson(response, report ? 200 : 400, report ? { report } : { error: 'Choose a campaign session.' }); return true
      }
      if (request.method === 'GET' && request.url === '/api/campaign/intelligence/rules') {
        sendJson(response, 200, { rules: store.listHouseRules(campaignId) }); return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/rules') {
        if (!isGm) { sendJson(response, 403, { error: 'Only a GM can record a house rule.' }); return true }
        const body = await readJson(request)
        const rule = { title: clean(body.title, 120), sourceRule: clean(body.sourceRule, 1_000), interpretation: clean(body.interpretation, 2_000), ruling: clean(body.ruling, 2_000), reason: clean(body.reason, 500) }
        if (Object.values(rule).some((value) => !value)) { sendJson(response, 400, { error: 'Every house-rule field is required.' }); return true }
        sendJson(response, 201, { rule: store.createHouseRule(campaignId, playerId, rule) }); return true
      }
      const ruleMutation = request.url.match(/^\/api\/campaign\/intelligence\/rules\/([^/]+)$/)
      if (request.method === 'PATCH' && ruleMutation) {
        if (!isGm) { sendJson(response, 403, { error: 'Only a GM can revise a house rule.' }); return true }
        const body = await readJson(request)
        const revision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        const fields = { title: clean(body.title, 120), sourceRule: clean(body.sourceRule, 1_000), interpretation: clean(body.interpretation, 2_000), ruling: clean(body.ruling, 2_000), status: ['active', 'retired'].includes(body.status) ? body.status : null, reason: clean(body.reason, 500), expectedRevision: revision }
        if (Object.values(fields).some((value) => value === null)) { sendJson(response, 400, { error: 'House-rule revision is invalid.' }); return true }
        const result = store.reviseHouseRule(campaignId, playerId, ruleMutation[1], fields)
        sendJson(response, result.outcome === 'not_found' ? 404 : result.outcome === 'conflict' ? 409 : 200, result.outcome === 'revised' ? { rule: result.rule } : { error: result.outcome === 'conflict' ? 'The house rule changed before your revision.' : 'House rule not found.', ...result })
        return true
      }
      const ruleHistory = request.url.match(/^\/api\/campaign\/intelligence\/rules\/([^/]+)\/history$/)
      if (request.method === 'GET' && ruleHistory) {
        const history = store.listHouseRuleHistory(campaignId, ruleHistory[1])
        sendJson(response, history ? 200 : 404, history ? { history } : { error: 'House rule not found.' }); return true
      }
      if (request.method === 'POST' && request.url === '/api/campaign/intelligence/factions') {
        if (!isGm) { sendJson(response, 403, { error: 'Faction clocks are private to GMs.' }); return true }
        const body = await readJson(request)
        const clock = { name: clean(body.name, 120), goal: clean(body.goal, 1_000), progress: Number.isInteger(body.progress) ? body.progress : 0, segments: Number.isInteger(body.segments) ? body.segments : 6 }
        if (!clock.name || !clock.goal || clock.segments < 2 || clock.segments > 12 || clock.progress < 0 || clock.progress > clock.segments) { sendJson(response, 400, { error: 'Faction clock is invalid.' }); return true }
        sendJson(response, 201, { clock: store.createFactionClock(campaignId, playerId, clock) }); return true
      }
      const factionProposal = request.url.match(/^\/api\/campaign\/intelligence\/factions\/([^/]+)\/proposals$/)
      if (request.method === 'POST' && factionProposal) {
        if (!isGm) { sendJson(response, 403, { error: 'Faction clocks are private to GMs.' }); return true }
        if (!intelligence) { sendJson(response, 503, { error: 'Faction proposals are not configured.' }); return true }
        const body = await readJson(request)
        const clock = store.listFactionClocks(campaignId).find((item) => item.id === factionProposal[1])
        const context = typeof body.sessionId === 'string' ? store.getCampaignSessionMessages(campaignId, body.sessionId, 5_000) : null
        if (!clock || !context || context.truncated) { sendJson(response, 400, { error: 'Choose a faction clock and campaign session.' }); return true }
        const proposal = await intelligence.proposeFaction({ clock, messages: context.messages, canon: store.listCanonEntries(campaignId, { includeGmOnly: true }) })
        sendJson(response, 201, { clock: store.createFactionProposal(campaignId, playerId, clock.id, { ...proposal, generatorVersion: intelligence.version }) }); return true
      }
      const factionDecision = request.url.match(/^\/api\/campaign\/intelligence\/faction-proposals\/([^/]+)\/decision$/)
      if (request.method === 'POST' && factionDecision) {
        if (!isGm) { sendJson(response, 403, { error: 'Faction clocks are private to GMs.' }); return true }
        const body = await readJson(request)
        if (!['accept', 'reject'].includes(body.action)) { sendJson(response, 400, { error: 'Faction decision is invalid.' }); return true }
        const result = store.decideFactionProposal(campaignId, playerId, factionDecision[1], body.action)
        sendJson(response, result.outcome === 'not_found' ? 404 : 200, result.outcome === 'not_found' ? { error: 'Faction proposal not found.' } : result); return true
      }

      sendJson(response, 404, { error: 'Campaign intelligence route not found.' })
      return true
    },
  }
}
