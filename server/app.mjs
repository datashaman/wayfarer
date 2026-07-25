import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { defaultIceServers } from './config.mjs'
import { createStore } from './store.mjs'
import { analyzeSessionInChunks, chunkSessionMessages } from './session-analysis.mjs'
import { calculateAutomationReadiness } from './feedback-evaluation.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5192']
const defaultRateLimits = {
  campaigns: { max: 10, windowMs: 10 * 60_000 },
  joins: { max: 30, windowMs: 10 * 60_000 },
  recoveries: { max: 10, windowMs: 10 * 60_000 },
}

function requestOriginAllowed(request, allowedOrigins) {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    if (new URL(origin).host === request.headers.host) return true
  } catch {
    return false
  }
  return allowedOrigins.has(origin)
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 65_536) throw new Error('request_too_large')
  }
  return JSON.parse(body || '{}')
}

function cleanName(value, maximum) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name && name.length <= maximum ? name : null
}

function cleanDescription(value, maximum) {
  const description = typeof value === 'string' ? value.trim() : ''
  return description.length <= maximum ? description : null
}

const canonKinds = new Set(['fact', 'character', 'relationship', 'promise', 'event', 'question', 'contradiction', 'rule'])
const canonVisibilities = new Set(['campaign', 'gm_only'])
const canonAudienceVisibilities = new Set(['campaign', 'gm_only', 'characters'])
const canonDecisionActions = new Set(['accept', 'edit_accept', 'dispute', 'reject'])
const continuityRatings = new Set(['useful', 'incorrect', 'secret_leak', 'not_useful'])
const continuityStatuses = new Set(['open', 'dormant', 'resolved'])
const canonThresholds = new Set(['explicit_only', 'table_consensus', 'played_as_true'])
const playerDeclarationPolicies = new Set(['require_confirmation', 'stand_unless_challenged'])
const canonOocPolicies = new Set(['exclude', 'explicit_corrections_only'])
const canonCorrectionPolicies = new Set(['latest_explicit', 'flag_conflicts'])

function cleanCanonText(value, maximum) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= maximum ? text : null
}

export function createRoomServer({ databasePath = join(root, 'data', 'wayfarer.sqlite'), dev = false, iceServers = defaultIceServers, allowedOrigins, trustProxy = false, rateLimits = {}, canonExtractor = null, continuityGenerator = null, contradictionRadar = null, recapGenerator = null } = {}) {
  const store = createStore(databasePath)
  const clients = new Map()
  const originAllowlist = new Set(allowedOrigins ?? (dev ? developmentOrigins : []))
  const limits = { ...defaultRateLimits, ...rateLimits }
  const rateBuckets = new Map()

  function requestAddress(request) {
    if (trustProxy) return request.headers['x-forwarded-for']?.split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
    return request.socket.remoteAddress || 'unknown'
  }

  function rateLimited(request, response, name) {
    const now = Date.now()
    if (rateBuckets.size > 1_000) for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key)
    const limit = limits[name]
    const key = `${name}:${requestAddress(request)}`
    let bucket = rateBuckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + limit.windowMs }
      rateBuckets.set(key, bucket)
    }
    bucket.count += 1
    response.setHeader('x-ratelimit-limit', limit.max)
    response.setHeader('x-ratelimit-remaining', Math.max(0, limit.max - bucket.count))
    if (bucket.count <= limit.max) return false
    response.setHeader('retry-after', Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)))
    sendJson(response, 429, { error: 'Too many attempts. Wait before trying again.' })
    return true
  }

  function canonLedger(campaignId, { includeGmOnly = false, viewerPlayerId = null } = {}) {
    return {
      proposals: store.listCanonProposals(campaignId, { includeGmOnly }),
      entries: store.listCanonEntries(campaignId, { includeGmOnly, viewerPlayerId }),
      coverage: store.getCanonCoverage(campaignId),
    }
  }

  const server = createServer(async (request, response) => {
    if (!requestOriginAllowed(request, originAllowlist)) {
      sendJson(response, 403, { error: 'Origin not allowed.' })
      return
    }
    if (request.headers.origin) {
      response.setHeader('access-control-allow-origin', request.headers.origin)
      response.setHeader('vary', 'Origin')
    }
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    try {
      if (request.method === 'GET' && request.url === '/api/health') {
        const healthy = store.health()
        sendJson(response, healthy ? 200 : 503, { status: healthy ? 'ok' : 'unavailable' })
        return
      }

      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
      const requestSession = token ? store.getSession(token) : null
      const hasGmKnowledge = requestSession?.player.knowledgeRole === 'gm'

      if (request.method === 'GET' && request.url === '/api/config') {
        sendJson(response, requestSession ? 200 : 401, requestSession ? { iceServers } : { error: 'Session not found.' })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/manage') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        sendJson(response, 200, store.getCampaignManagement(requestSession.campaign.id))
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/members') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        sendJson(response, 200, { players: store.listCampaignMembers(requestSession.campaign.id) })
        return
      }

      const characterKnowledge = request.url?.match(/^\/api\/campaign\/knowledge\/players\/([^/]+)$/)
      if (request.method === 'GET' && characterKnowledge) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Character knowledge lenses are private to GMs.' })
          return
        }
        const knowledge = store.getCharacterKnowledge(requestSession.campaign.id, characterKnowledge[1])
        sendJson(response, knowledge ? 200 : 404, knowledge ?? { error: 'Player not found.' })
        return
      }

      const knowledgeRoleMutation = request.url?.match(/^\/api\/campaign\/players\/([^/]+)\/knowledge-role$/)
      if (request.method === 'PATCH' && knowledgeRoleMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can assign GM access.' })
          return
        }
        const body = await readJson(request)
        const knowledgeRole = body.knowledgeRole === 'gm' || body.knowledgeRole === 'player' ? body.knowledgeRole : null
        if (!knowledgeRole) {
          sendJson(response, 400, { error: 'Knowledge role is invalid.' })
          return
        }
        const result = store.setPlayerKnowledgeRole(requestSession.campaign.id, knowledgeRoleMutation[1], knowledgeRole)
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Player not found.' })
          return
        }
        if (result.outcome === 'owner') {
          sendJson(response, 400, { error: 'The campaign owner always has GM access.' })
          return
        }
        for (const [socket, client] of clients) {
          if (client.player.id !== knowledgeRoleMutation[1]) continue
          client.player = { ...client.player, knowledgeRole }
          send(socket, envelope('session.updated', client.campaign.id, { player: client.player }))
        }
        sendJson(response, 200, result.management)
        return
      }

      if (request.method === 'GET' && request.url?.startsWith('/api/campaign/search')) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const query = new URL(request.url, 'http://localhost').searchParams.get('q')?.trim() ?? ''
        if (!query || query.length > 80) {
          sendJson(response, 400, { error: 'Search text must be between 1 and 80 characters.' })
          return
        }
        sendJson(response, 200, { results: store.searchMessages(requestSession.campaign.id, query) })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/notes') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        sendJson(response, 200, { note: store.getCampaignNote(requestSession.campaign.id) })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/sessions') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        sendJson(response, 200, { sessions: store.listCampaignSessions(requestSession.campaign.id) })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/sessions/close') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can close a campaign session.' })
          return
        }
        const body = await readJson(request)
        const title = cleanName(body.title, 80)
        if (!title) {
          sendJson(response, 400, { error: 'A session title is required.' })
          return
        }
        const result = store.closeCampaignSession(requestSession.campaign.id, requestSession.player.id, title)
        if (result.outcome === 'empty') {
          sendJson(response, 400, { error: 'The current session has no transcript messages.' })
          return
        }
        sendJson(response, 201, { sessions: result.sessions })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/canon') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const includeGmOnly = hasGmKnowledge
        sendJson(response, 200, canonLedger(requestSession.campaign.id, { includeGmOnly, viewerPlayerId: requestSession.player.id }))
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/recaps/latest') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const recap = store.getLatestSessionRecap(requestSession.campaign.id, { includeDrafts: hasGmKnowledge, includeGmNotes: hasGmKnowledge })
        sendJson(response, 200, { recap })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/ai/readiness') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'AI readiness is private to GMs.' })
          return
        }
        sendJson(response, 200, {
          readiness: calculateAutomationReadiness(store.exportAiFeedback(requestSession.campaign.id)),
          evaluationRuns: store.listAiEvaluationRuns(requestSession.campaign.id, 10),
        })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/recaps/extract') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can prepare a session recap.' })
          return
        }
        if (!recapGenerator) {
          sendJson(response, 503, { error: 'Session recaps are not configured.' })
          return
        }
        const body = await readJson(request)
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.length <= 100 ? body.sessionId : null
        const context = sessionId ? store.getCampaignSessionMessages(requestSession.campaign.id, sessionId, 5_000) : null
        if (!context || context.truncated) {
          sendJson(response, 400, { error: context?.truncated ? 'This session exceeds the 5,000-message processing limit.' : 'Choose a campaign session with transcript messages.' })
          return
        }
        const acceptedCanon = store.listCanonEntries(requestSession.campaign.id, { includeGmOnly: true })
        const drafts = []
        for (const messages of chunkSessionMessages(context.messages)) {
          drafts.push(await recapGenerator.generate({ campaignId: requestSession.campaign.id, messages, acceptedCanon }))
        }
        const sourceMap = new Map(drafts.flatMap((draft) => draft.sources).map((source) => [source.messageId, source]))
        const result = store.createSessionRecap({
          campaignId: requestSession.campaign.id, playerId: requestSession.player.id,
          generatorVersion: recapGenerator.version, session: context.session,
          publicSummary: drafts.map((draft) => draft.publicSummary).join('\n\n').slice(0, 5_000),
          gmNotes: drafts.map((draft) => draft.gmNotes).join('\n\n').slice(0, 5_000),
          sources: [...sourceMap.values()].slice(0, 20),
        })
        sendJson(response, result.outcome === 'created' ? 201 : 400, result.outcome === 'created' ? { recap: result.recap } : { error: 'Every recap citation must belong to this campaign.' })
        return
      }

      const recapPublish = request.url?.match(/^\/api\/campaign\/recaps\/([^/]+)\/publish$/)
      if (request.method === 'POST' && recapPublish) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can publish a session recap.' })
          return
        }
        const result = store.publishSessionRecap(requestSession.campaign.id, requestSession.player.id, recapPublish[1])
        sendJson(response, result.outcome === 'not_found' ? 404 : 200, result.outcome === 'not_found' ? { error: 'Session recap not found.' } : { recap: result.recap })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/canon/constitution') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'The canon constitution is private to GMs.' })
          return
        }
        sendJson(response, 200, { constitution: store.getCanonConstitution(requestSession.campaign.id) })
        return
      }

      if (request.method === 'PUT' && request.url === '/api/campaign/canon/constitution') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can revise the canon constitution.' })
          return
        }
        const body = await readJson(request)
        const constitution = {
          canonThreshold: canonThresholds.has(body.canonThreshold) ? body.canonThreshold : null,
          playerDeclarations: playerDeclarationPolicies.has(body.playerDeclarations) ? body.playerDeclarations : null,
          oocPolicy: canonOocPolicies.has(body.oocPolicy) ? body.oocPolicy : null,
          correctionPolicy: canonCorrectionPolicies.has(body.correctionPolicy) ? body.correctionPolicy : null,
          defaultVisibility: canonVisibilities.has(body.defaultVisibility) ? body.defaultVisibility : null,
          guidance: cleanDescription(body.guidance, 1_000),
        }
        const revision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        if (Object.values(constitution).some((value) => value === null) || revision === null) {
          sendJson(response, 400, { error: 'Canon constitution fields are invalid.' })
          return
        }
        const result = store.updateCanonConstitution(requestSession.campaign.id, requestSession.player.id, constitution, revision)
        if (result.conflict) {
          sendJson(response, 409, { error: 'The canon constitution changed before your revision was saved.', constitution: result.constitution })
          return
        }
        sendJson(response, 200, { constitution: result.constitution })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/canon/proposals') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can propose canon.' })
          return
        }
        const body = await readJson(request)
        const kind = canonKinds.has(body.kind) ? body.kind : null
        const title = cleanCanonText(body.title, 80)
        const claim = cleanCanonText(body.claim, 2_000)
        const visibility = canonVisibilities.has(body.visibility) ? body.visibility : null
        const confidence = body.confidence === null || body.confidence === undefined
          ? null
          : typeof body.confidence === 'number' && body.confidence >= 0 && body.confidence <= 1 ? body.confidence : undefined
        const extractorVersion = cleanCanonText(body.extractorVersion, 80)
        const sources = Array.isArray(body.sources) && body.sources.length > 0 && body.sources.length <= 10
          && body.sources.every((source) => typeof source?.messageId === 'string'
            && source.messageId.length <= 100
            && (source.excerpt === undefined || (typeof source.excerpt === 'string' && source.excerpt.length <= 500)))
          ? body.sources
          : null
        if (!kind || !title || !claim || !visibility || confidence === undefined || !extractorVersion || !sources) {
          sendJson(response, 400, { error: 'Canon proposal fields or citations are invalid.' })
          return
        }
        const result = store.createCanonProposal({
          campaignId: requestSession.campaign.id,
          playerId: requestSession.player.id,
          kind,
          title,
          claim,
          visibility,
          confidence,
          extractorVersion,
          sources,
        })
        if (result.outcome === 'invalid_source') {
          sendJson(response, 400, { error: 'Every citation must belong to this campaign.' })
          return
        }
        if (result.outcome === 'sources_required') {
          sendJson(response, 400, { error: 'Canon proposals require transcript citations.' })
          return
        }
        broadcastCanon(requestSession.campaign.id)
        sendJson(response, result.outcome === 'created' ? 201 : 200, { outcome: result.outcome, proposal: result.proposal })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/canon/extract') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can ask for canon suggestions.' })
          return
        }
        if (!canonExtractor) {
          sendJson(response, 503, { error: 'Canon extraction is not configured.' })
          return
        }
        const coverage = store.getCanonCoverage(requestSession.campaign.id)
        const messages = store.listUnscannedCampaignMessages(requestSession.campaign.id, 100)
        if (!messages.length) {
          sendJson(response, coverage.latestSequence ? 200 : 400, coverage.latestSequence
            ? canonLedger(requestSession.campaign.id, { includeGmOnly: true })
            : { error: 'The transcript needs at least one message before canon can be suggested.' })
          return
        }
        const existingCanon = store.listCanonEntries(requestSession.campaign.id, { includeGmOnly: true })
        const priorDecisions = store.listCanonDecisionExamples(requestSession.campaign.id, 20)
        const constitution = store.getCanonConstitution(requestSession.campaign.id)
        const drafts = await canonExtractor.extract({ campaignId: requestSession.campaign.id, messages, existingCanon, priorDecisions, constitution })
        for (const draft of drafts) store.createCanonProposal({
          campaignId: requestSession.campaign.id,
          playerId: requestSession.player.id,
          extractorVersion: canonExtractor.version,
          ...draft,
        })
        store.markCanonScanned(requestSession.campaign.id, requestSession.player.id, messages.at(-1).sequence)
        broadcastCanon(requestSession.campaign.id)
        sendJson(response, 200, canonLedger(requestSession.campaign.id, { includeGmOnly: true }))
        return
      }

      const canonDecision = request.url?.match(/^\/api\/campaign\/canon\/proposals\/([^/]+)\/decisions$/)
      if (request.method === 'POST' && canonDecision) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can decide canon.' })
          return
        }
        const body = await readJson(request)
        const action = canonDecisionActions.has(body.action) ? body.action : null
        const reason = body.reason === undefined || body.reason === null || body.reason === ''
          ? null
          : cleanCanonText(body.reason, 500)
        const title = action === 'edit_accept' ? cleanCanonText(body.title, 80) : null
        const claim = action === 'edit_accept' ? cleanCanonText(body.claim, 2_000) : null
        const visibility = action === 'accept' || action === 'edit_accept'
          ? canonAudienceVisibilities.has(body.visibility) ? body.visibility : null
          : null
        const audiencePlayerIds = visibility === 'characters' && Array.isArray(body.audiencePlayerIds)
          && body.audiencePlayerIds.length > 0 && body.audiencePlayerIds.length <= 50
          && body.audiencePlayerIds.every((id) => typeof id === 'string' && id.length <= 100) ? body.audiencePlayerIds : []
        if (!action || reason === undefined || (action === 'edit_accept' && (!title || !claim)) || ((action === 'accept' || action === 'edit_accept') && (!visibility || (visibility === 'characters' && !audiencePlayerIds.length)))) {
          sendJson(response, 400, { error: 'Canon decision fields are invalid.' })
          return
        }
        const result = store.decideCanonProposal(requestSession.campaign.id, requestSession.player.id, canonDecision[1], { action, reason, title, claim, visibility, audiencePlayerIds })
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Canon proposal not found.' })
          return
        }
        if (result.outcome === 'already_decided') {
          sendJson(response, 409, { error: 'This proposal was already decided.', proposal: result.proposal })
          return
        }
        if (result.outcome === 'invalid_audience') {
          sendJson(response, 400, { error: 'Every canon audience must be an active campaign seat.' })
          return
        }
        broadcastCanon(requestSession.campaign.id)
        sendJson(response, 200, { proposal: result.proposal, ...canonLedger(requestSession.campaign.id, { includeGmOnly: true }) })
        return
      }

      const canonEntryHistory = request.url?.match(/^\/api\/campaign\/canon\/entries\/([^/]+)\/history$/)
      if (request.method === 'GET' && canonEntryHistory) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const history = store.listCanonEntryHistory(requestSession.campaign.id, canonEntryHistory[1], { includeGmOnly: hasGmKnowledge, viewerPlayerId: requestSession.player.id })
        sendJson(response, history ? 200 : 404, history ?? { error: 'Canon entry not found.' })
        return
      }

      const canonEntryMutation = request.url?.match(/^\/api\/campaign\/canon\/entries\/([^/]+)$/)
      if (request.method === 'PATCH' && canonEntryMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can revise canon.' })
          return
        }
        const body = await readJson(request)
        const action = body.action === 'revise' || body.action === 'supersede' ? body.action : null
        const title = cleanCanonText(body.title, 80)
        const claim = cleanCanonText(body.claim, 2_000)
        const visibility = canonAudienceVisibilities.has(body.visibility) ? body.visibility : null
        const audiencePlayerIds = visibility === 'characters' && Array.isArray(body.audiencePlayerIds)
          && body.audiencePlayerIds.length > 0 && body.audiencePlayerIds.length <= 50
          && body.audiencePlayerIds.every((id) => typeof id === 'string' && id.length <= 100) ? body.audiencePlayerIds : []
        const expectedRevision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        const reason = body.reason === undefined || body.reason === null || body.reason === '' ? null : cleanCanonText(body.reason, 500)
        if (!action || !title || !claim || !visibility || (visibility === 'characters' && !audiencePlayerIds.length) || expectedRevision === null || reason === undefined || (action === 'supersede' && !reason)) {
          sendJson(response, 400, { error: 'Canon revision fields are invalid.' })
          return
        }
        const historyAction = action === 'revise' ? 'revised' : 'superseded'
        const result = store.reviseCanonEntry(requestSession.campaign.id, requestSession.player.id, canonEntryMutation[1], { action: historyAction, title, claim, visibility, audiencePlayerIds, reason, expectedRevision })
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Canon entry not found.' })
          return
        }
        if (result.outcome === 'conflict') {
          sendJson(response, 409, { error: 'This canon entry changed before your revision was saved.', entry: result.entry })
          return
        }
        if (result.outcome === 'invalid_audience') {
          sendJson(response, 400, { error: 'Every canon audience must be an active campaign seat.' })
          return
        }
        broadcastCanon(requestSession.campaign.id)
        sendJson(response, 200, {
          entry: result.entry,
          ...canonLedger(requestSession.campaign.id, { includeGmOnly: true }),
        })
        return
      }

      if (request.method === 'DELETE' && canonEntryMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can retract canon.' })
          return
        }
        const body = await readJson(request)
        const expectedRevision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        const reason = cleanCanonText(body.reason, 500)
        if (expectedRevision === null || !reason) {
          sendJson(response, 400, { error: 'A current revision and retraction reason are required.' })
          return
        }
        const result = store.retractCanonEntry(requestSession.campaign.id, requestSession.player.id, canonEntryMutation[1], { reason, expectedRevision })
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Canon entry not found.' })
          return
        }
        if (result.outcome === 'conflict') {
          sendJson(response, 409, { error: 'This canon entry changed before it could be retracted.', entry: result.entry })
          return
        }
        broadcastCanon(requestSession.campaign.id)
        sendJson(response, 200, {
          entry: result.entry,
          ...canonLedger(requestSession.campaign.id, { includeGmOnly: true }),
        })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/continuity') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'The continuity brief is private to GMs.' })
          return
        }
        sendJson(response, 200, { brief: store.getLatestContinuityBrief(requestSession.campaign.id) })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/contradictions') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Contradiction reports are private to GMs.' })
          return
        }
        sendJson(response, 200, { report: store.getLatestContradictionReport(requestSession.campaign.id) })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/contradictions/extract') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can check contradictions.' })
          return
        }
        if (!contradictionRadar) {
          sendJson(response, 503, { error: 'Contradiction checking is not configured.' })
          return
        }
        const body = await readJson(request)
        const sessionId = body.sessionId === undefined ? null : typeof body.sessionId === 'string' && body.sessionId.length <= 100 ? body.sessionId : undefined
        if (sessionId === undefined) {
          sendJson(response, 400, { error: 'Session selection is invalid.' })
          return
        }
        const context = store.getCampaignSessionMessages(requestSession.campaign.id, sessionId, 5_000)
        if (!context) {
          sendJson(response, 400, { error: 'Choose a campaign session with transcript messages.' })
          return
        }
        if (context.truncated) {
          sendJson(response, 400, { error: 'This session exceeds the 5,000-message processing limit.' })
          return
        }
        const acceptedCanon = store.listCanonEntries(requestSession.campaign.id, { includeGmOnly: true })
        if (!acceptedCanon.length) {
          sendJson(response, 400, { error: 'Accept at least one canon passage before checking for contradictions.' })
          return
        }
        const messages = context.messages
        if (!messages.length) {
          sendJson(response, 400, { error: 'The transcript needs at least one message before contradictions can be checked.' })
          return
        }
        const findings = await analyzeSessionInChunks({
          messages,
          maximum: 5,
          keyFields: ['canonEntryId', 'title', 'explanation'],
          analyze: (chunk) => contradictionRadar.inspect({ campaignId: requestSession.campaign.id, messages: chunk, acceptedCanon }),
        })
        const result = store.createContradictionReport({
          campaignId: requestSession.campaign.id,
          playerId: requestSession.player.id,
          generatorVersion: contradictionRadar.version,
          session: context.session,
          findings,
        })
        if (result.outcome === 'invalid_source') {
          sendJson(response, 400, { error: 'Every contradiction must cite canon and transcript from this campaign.' })
          return
        }
        sendJson(response, 200, { report: result.report, session: context.session })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/continuity/extract') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'Only a GM can prepare a continuity brief.' })
          return
        }
        if (!continuityGenerator) {
          sendJson(response, 503, { error: 'Continuity briefs are not configured.' })
          return
        }
        const body = await readJson(request)
        const sessionId = body.sessionId === undefined ? null : typeof body.sessionId === 'string' && body.sessionId.length <= 100 ? body.sessionId : undefined
        if (sessionId === undefined) {
          sendJson(response, 400, { error: 'Session selection is invalid.' })
          return
        }
        const context = store.getCampaignSessionMessages(requestSession.campaign.id, sessionId, 5_000)
        if (!context) {
          sendJson(response, 400, { error: 'Choose a campaign session with transcript messages.' })
          return
        }
        if (context.truncated) {
          sendJson(response, 400, { error: 'This session exceeds the 5,000-message processing limit.' })
          return
        }
        const acceptedCanon = store.listCanonEntries(requestSession.campaign.id, { includeGmOnly: true })
        const priorFeedback = store.listContinuityFeedbackExamples(requestSession.campaign.id, 20)
        const messages = context.messages
        if (!messages.length) {
          sendJson(response, 400, { error: 'The transcript needs at least one message before a brief can be prepared.' })
          return
        }
        const threads = await analyzeSessionInChunks({
          messages,
          maximum: 3,
          keyFields: ['title', 'summary'],
          analyze: (chunk) => continuityGenerator.generate({ campaignId: requestSession.campaign.id, messages: chunk, acceptedCanon, priorFeedback }),
        })
        const result = store.createContinuityBrief({
          campaignId: requestSession.campaign.id,
          playerId: requestSession.player.id,
          generatorVersion: continuityGenerator.version,
          session: context.session,
          threads,
        })
        if (result.outcome === 'invalid_source') {
          sendJson(response, 400, { error: 'Every continuity citation must belong to this campaign.' })
          return
        }
        sendJson(response, 200, { brief: result.brief, session: context.session })
        return
      }

      const continuityFeedback = request.url?.match(/^\/api\/campaign\/continuity\/threads\/([^/]+)\/feedback$/)
      if (request.method === 'POST' && continuityFeedback) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'The continuity brief is private to GMs.' })
          return
        }
        const body = await readJson(request)
        const rating = continuityRatings.has(body.rating) ? body.rating : null
        if (!rating) {
          sendJson(response, 400, { error: 'Continuity feedback is invalid.' })
          return
        }
        const brief = store.recordContinuityFeedback(requestSession.campaign.id, requestSession.player.id, continuityFeedback[1], rating)
        sendJson(response, brief ? 200 : 404, brief ? { brief } : { error: 'Continuity thread not found.' })
        return
      }

      const continuityLifecycle = request.url?.match(/^\/api\/campaign\/continuity\/threads\/([^/]+)\/lifecycle$/)
      if (request.method === 'POST' && continuityLifecycle) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (!hasGmKnowledge) {
          sendJson(response, 403, { error: 'The continuity brief is private to GMs.' })
          return
        }
        const body = await readJson(request)
        const status = continuityStatuses.has(body.status) ? body.status : null
        const reason = cleanCanonText(body.reason, 500)
        if (!status || !reason) {
          sendJson(response, 400, { error: 'A continuity status and reason are required.' })
          return
        }
        const brief = store.transitionContinuityThread(requestSession.campaign.id, requestSession.player.id, continuityLifecycle[1], status, reason)
        sendJson(response, brief ? 200 : 404, brief ? { brief } : { error: 'Continuity thread not found.' })
        return
      }

      if (request.method === 'GET' && request.url === '/api/campaign/activity') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        sendJson(response, 200, { unreadRooms: store.getUnreadRooms(requestSession.campaign.id, requestSession.player.id) })
        return
      }

      const messageHistory = request.url?.match(/^\/api\/rooms\/([^/?]+)\/messages(?:\?.*)?$/)
      if (request.method === 'GET' && messageHistory) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const room = store.getRoom(messageHistory[1], requestSession.campaign.id)
        if (!room) {
          sendJson(response, 404, { error: 'Room not found.' })
          return
        }
        const before = Number(new URL(request.url, 'http://localhost').searchParams.get('before'))
        if (!Number.isSafeInteger(before) || before <= 0) {
          sendJson(response, 400, { error: 'A valid message cursor is required.' })
          return
        }
        sendJson(response, 200, store.listMessages(room.id, { before, limit: 50 }))
        return
      }

      if (request.method === 'PUT' && request.url === '/api/campaign/notes') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        const body = await readJson(request)
        const noteBody = typeof body.body === 'string' && body.body.length <= 20_000 ? body.body : null
        const revision = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null
        if (noteBody === null || revision === null) {
          sendJson(response, 400, { error: 'Note text or revision is invalid.' })
          return
        }
        const result = store.updateCampaignNote(requestSession.campaign.id, requestSession.player.id, noteBody, revision)
        if (result.conflict) {
          sendJson(response, 409, { error: 'The notes changed at another seat. Load the latest copy before saving.', note: result.note })
          return
        }
        broadcastCampaignEvent(requestSession.campaign.id, envelope('campaign.note_updated', requestSession.campaign.id, { note: result.note }))
        sendJson(response, 200, { note: result.note })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/invitation') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const campaign = store.rotateInvitation(requestSession.campaign.id)
        broadcastCampaign(campaign)
        sendJson(response, 200, { campaign })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/rooms') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const name = cleanName(body.name, 40)
        const description = cleanDescription(body.description, 120)
        if (!name || description === null) {
          sendJson(response, 400, { error: 'Room name or description is invalid.' })
          return
        }
        const campaign = store.createRoom(requestSession.campaign.id, name, description)
        broadcastCampaign(campaign)
        sendJson(response, 201, { campaign })
        return
      }

      const roomMutation = request.url?.match(/^\/api\/campaign\/rooms\/([^/]+)$/)
      if (request.method === 'PATCH' && roomMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const name = cleanName(body.name, 40)
        const description = cleanDescription(body.description, 120)
        if (!name || description === null) {
          sendJson(response, 400, { error: 'Room name or description is invalid.' })
          return
        }
        const campaign = store.updateRoom(requestSession.campaign.id, roomMutation[1], name, description)
        if (campaign) broadcastCampaign(campaign)
        sendJson(response, campaign ? 200 : 404, campaign ? { campaign } : { error: 'Room not found.' })
        return
      }

      if (request.method === 'DELETE' && roomMutation) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const result = store.archiveRoom(requestSession.campaign.id, roomMutation[1])
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Room not found.' })
          return
        }
        if (result.outcome === 'last_room') {
          sendJson(response, 400, { error: 'A campaign must keep at least one active room.' })
          return
        }
        broadcastCampaign(result.campaign)
        sendJson(response, 200, { campaign: result.campaign })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaign/rooms/reorder') {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const body = await readJson(request)
        const roomIds = Array.isArray(body.roomIds) && body.roomIds.every((roomId) => typeof roomId === 'string') ? body.roomIds : null
        const campaign = roomIds ? store.reorderRooms(requestSession.campaign.id, roomIds) : null
        if (campaign) broadcastCampaign(campaign)
        sendJson(response, campaign ? 200 : 400, campaign ? { campaign } : { error: 'Room order must include every active room once.' })
        return
      }

      const playerRemoval = request.url?.match(/^\/api\/campaign\/players\/([^/]+)$/)
      if (request.method === 'DELETE' && playerRemoval) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const result = store.removePlayer(requestSession.campaign.id, playerRemoval[1])
        if (result.outcome === 'owner') {
          sendJson(response, 400, { error: 'The campaign owner cannot be removed.' })
          return
        }
        if (result.outcome === 'not_found') {
          sendJson(response, 404, { error: 'Player not found.' })
          return
        }
        for (const [socket, client] of clients) {
          if (client.player.id !== playerRemoval[1]) continue
          send(socket, envelope('session.revoked', client.roomId || client.campaign.id, { reason: 'removed' }))
          socket.close(4003, 'Player removed')
        }
        sendJson(response, 200, result.management)
        return
      }

      const recoveryReset = request.url?.match(/^\/api\/campaign\/players\/([^/]+)\/recovery$/)
      if (request.method === 'POST' && recoveryReset) {
        if (!requestSession) {
          sendJson(response, 401, { error: 'Session not found.' })
          return
        }
        if (requestSession.player.role !== 'owner') {
          sendJson(response, 403, { error: 'Only the campaign owner can manage this table.' })
          return
        }
        const recoveryCode = store.resetRecoveryKey(requestSession.campaign.id, recoveryReset[1])
        sendJson(response, recoveryCode ? 200 : 404, recoveryCode ? { recoveryCode } : { error: 'Player not found.' })
        return
      }

      if (request.method === 'POST' && request.url === '/api/campaigns') {
        if (rateLimited(request, response, 'campaigns')) return
        const body = await readJson(request)
        const campaignName = cleanName(body.campaignName, 80)
        const playerName = cleanName(body.playerName, 40)
        if (!campaignName || !playerName) {
          sendJson(response, 400, { error: 'Campaign and player names are required.' })
          return
        }
        sendJson(response, 201, store.createCampaign(campaignName, playerName))
        return
      }

      const invitation = request.url?.match(/^\/api\/invitations\/([a-z0-9]{10})\/join$/)
      if (request.method === 'POST' && invitation) {
        if (rateLimited(request, response, 'joins')) return
        const body = await readJson(request)
        const playerName = cleanName(body.playerName, 40)
        if (!playerName) {
          sendJson(response, 400, { error: 'Player name is required.' })
          return
        }
        const joined = store.joinCampaign(invitation[1], playerName)
        if (!joined) {
          sendJson(response, 404, { error: 'This invitation is no longer available.' })
          return
        }
        if (joined.duplicate) {
          sendJson(response, 409, { error: 'That name already has a seat in this campaign.' })
          return
        }
        sendJson(response, 201, joined)
        return
      }

      const recovery = request.url?.match(/^\/api\/invitations\/([a-z0-9]{10})\/recover$/)
      if (request.method === 'POST' && recovery) {
        if (rateLimited(request, response, 'recoveries')) return
        const body = await readJson(request)
        const playerName = cleanName(body.playerName, 40)
        const recoveryCode = typeof body.recoveryCode === 'string' && body.recoveryCode.length <= 64 ? body.recoveryCode : ''
        if (!playerName || !recoveryCode) {
          sendJson(response, 400, { error: 'Player name and seat key are required.' })
          return
        }
        const recovered = store.recoverPlayer(recovery[1], playerName, recoveryCode)
        if (!recovered) {
          sendJson(response, 404, { error: 'This invitation is no longer available.' })
          return
        }
        if (recovered.invalid) {
          sendJson(response, 401, { error: 'That name and seat key do not match.' })
          return
        }
        for (const [socket, client] of clients) {
          if (client.player.id !== recovered.player.id) continue
          send(socket, envelope('session.revoked', client.roomId || client.campaign.id, { reason: 'recovered' }))
          socket.close(4003, 'Seat recovered')
        }
        sendJson(response, 200, recovered)
        return
      }

      if (request.method === 'GET' && request.url === '/api/session') {
        sendJson(response, requestSession ? 200 : 401, requestSession ?? { error: 'Session not found.' })
        return
      }

      if (request.url?.startsWith('/api/')) {
        sendJson(response, 404, { error: 'Not found.' })
        return
      }

      if (dev) {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Wayfarer room server')
        return
      }

      const requested = request.url === '/' ? '/index.html' : (request.url ?? '/index.html')
      const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '')
      let file = join(dist, safePath)
      if (!existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html')
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(response)
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : error?.message === 'request_too_large' ? 413 : 500
      sendJson(response, status, { error: status === 500 ? 'Unexpected server error.' : 'Invalid request.' })
    }
  })
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient({ req }, done) {
      if (!requestOriginAllowed(req, originAllowlist)) {
        done(false, 403, 'Origin not allowed')
        return
      }
      const token = new URL(req.url, 'http://localhost').searchParams.get('token') ?? ''
      const session = token ? store.getSession(token) : null
      if (!session) {
        done(false, 401, 'Unauthorized')
        return
      }
      req.session = session
      done(true)
    },
  })

  function envelope(type, roomId, payload) {
    return { type, id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload }
  }

  function send(socket, event) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
  }

  function members(roomId) {
    return [...clients.entries()].filter(([, client]) => client.roomId === roomId)
  }

  function participant(client) {
    return { playerId: client.player.id, name: client.player.name, muted: client.muted }
  }

  function broadcast(roomId, event, except) {
    for (const [socket] of members(roomId)) if (socket !== except) send(socket, event)
  }

  function broadcastCampaign(campaign) {
    const event = envelope('campaign.updated', campaign.id, { campaign })
    for (const [socket, client] of clients) {
      if (client.campaign.id !== campaign.id) continue
      client.campaign = campaign
      send(socket, event)
    }
  }

  function broadcastCampaignEvent(campaignId, event) {
    for (const [socket, client] of clients) if (client.campaign.id === campaignId) send(socket, event)
  }

  function broadcastCanon(campaignId) {
    for (const [socket, client] of clients) {
      if (client.campaign.id !== campaignId) continue
      const includeGmOnly = client.player.knowledgeRole === 'gm'
      send(socket, envelope('campaign.canon_updated', campaignId, canonLedger(campaignId, { includeGmOnly, viewerPlayerId: client.player.id })))
    }
  }

  function presenceSnapshot(roomId) {
    if (!roomId) return
    broadcast(roomId, envelope('presence.snapshot', roomId, { participants: members(roomId).map(([, client]) => participant(client)) }))
  }

  function leaveVoice(socket, client) {
    if (!client.inVoice || !client.roomId) return
    client.inVoice = false
    client.muted = false
    broadcast(client.roomId, envelope('voice.participant_left', client.roomId, { playerId: client.player.id }), socket)
  }

  function validEnvelope(event) {
    return event && typeof event === 'object' && typeof event.type === 'string' && typeof event.roomId === 'string' && event.payload && typeof event.payload === 'object'
  }

  wss.on('connection', (socket, request) => {
    const session = request.session
    const client = { player: session.player, campaign: session.campaign, roomId: '', inVoice: false, muted: false }
    clients.set(socket, client)

    socket.on('message', (raw) => {
      let event
      try {
        event = JSON.parse(String(raw))
      } catch {
        send(socket, envelope('error', client.roomId || 'unknown', { code: 'invalid_json', message: 'Invalid event.', retryable: false }))
        return
      }
      if (!validEnvelope(event)) {
        send(socket, envelope('error', client.roomId || 'unknown', { code: 'invalid_event', message: 'Invalid event.', retryable: false }))
        return
      }

      if (event.type === 'room.subscribe') {
        const room = store.getRoom(event.roomId, client.campaign.id)
        if (!room) {
          send(socket, envelope('error', event.roomId, { code: 'room_forbidden', message: 'Room not found.', retryable: false }))
          return
        }
        const previousRoom = client.roomId
        if (previousRoom && previousRoom !== room.id) leaveVoice(socket, client)
        client.roomId = room.id
        store.markRoomRead(client.player.id, room.id)
        if (previousRoom && previousRoom !== client.roomId) presenceSnapshot(previousRoom)
        const roomMembers = members(client.roomId)
        const history = store.listMessages(client.roomId)
        send(socket, envelope('room.snapshot', client.roomId, {
          participants: roomMembers.map(([, member]) => participant(member)),
          voiceParticipants: roomMembers.filter(([, member]) => member.inVoice).map(([, member]) => participant(member)),
          messages: history.messages,
          hasMore: history.hasMore,
        }))
        presenceSnapshot(client.roomId)
        return
      }

      if (!client.roomId || event.roomId !== client.roomId) return

      if (event.type === 'chat.send') {
        const text = typeof event.payload.text === 'string' ? event.payload.text.trim().slice(0, 2_000) : ''
        const clientMessageId = typeof event.payload.clientMessageId === 'string' ? event.payload.clientMessageId.slice(0, 100) : ''
        if (!text || !clientMessageId) {
          send(socket, envelope('error', client.roomId, { code: 'invalid_message', message: 'Message is invalid.', retryable: false }))
          return
        }
        const stored = store.addMessage({
          roomId: client.roomId,
          playerId: client.player.id,
          clientMessageId,
          text,
        })
        if (!stored.inserted) {
          send(socket, envelope('chat.message', client.roomId, stored.message))
          return
        }
        for (const [, member] of members(client.roomId)) store.markRoomRead(member.player.id, client.roomId)
        broadcast(client.roomId, envelope('chat.message', client.roomId, stored.message))
        broadcastCampaignEvent(client.campaign.id, envelope('room.activity', client.roomId, { senderId: client.player.id }))
        return
      }

      if (event.type === 'voice.join') {
        const existing = members(client.roomId)
          .filter(([other, member]) => other !== socket && member.inVoice)
          .map(([, member]) => participant(member))
        client.inVoice = true
        client.muted = false
        send(socket, envelope('voice.roster', client.roomId, { participants: existing }))
        broadcast(client.roomId, envelope('voice.participant_joined', client.roomId, { participant: participant(client) }), socket)
        return
      }

      if (event.type === 'voice.leave') {
        leaveVoice(socket, client)
        return
      }

      if (event.type === 'voice.mute_changed' && typeof event.payload.muted === 'boolean') {
        client.muted = event.payload.muted
        broadcast(client.roomId, envelope('voice.mute_changed', client.roomId, { playerId: client.player.id, muted: client.muted }))
        return
      }

      if (['voice.offer', 'voice.answer', 'voice.ice_candidate'].includes(event.type)) {
        const targetId = typeof event.payload.targetPlayerId === 'string' ? event.payload.targetPlayerId : ''
        const target = members(client.roomId).find(([, member]) => member.player.id === targetId && member.inVoice)
        if (!target || !client.inVoice) return
        const payload = event.type === 'voice.ice_candidate'
          ? { fromPlayerId: client.player.id, candidate: event.payload.candidate }
          : { fromPlayerId: client.player.id, sdp: event.payload.sdp }
        send(target[0], envelope(event.type, client.roomId, payload))
        return
      }

      if (event.type === 'ping' && Number.isInteger(event.payload.sequence)) send(socket, envelope('pong', client.roomId, event.payload))
    })

    socket.on('close', () => {
      const roomId = client.roomId
      leaveVoice(socket, client)
      clients.delete(socket)
      presenceSnapshot(roomId)
    })
  })

  return {
    store,
    async listen(port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, resolve)
      })
      return server.address().port
    },
    async close() {
      for (const socket of wss.clients) socket.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => server.close(resolve))
      store.close()
    },
  }
}
