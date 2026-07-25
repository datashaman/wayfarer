import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRoomServer } from '../server/app.mjs'

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...options.headers } })
  return { status: response.status, body: await response.json() }
}

test('campaign intelligence keeps preparation, memory, rules, factions, spotlight, and intent inside their authority boundaries', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-intelligence-'))
  let latestKnowledgeFeedback = []
  const intelligence = {
    version: 'fixture:intelligence-v1',
    async answerKnowledge({ canon, priorFeedback }) { latestKnowledgeFeedback = priorFeedback; return { answer: 'Ilyra keeps the western light.', citations: [canon[0].id] } },
    async draftIntent() { return ['I lift the brass lantern.', 'Let the old light answer us.'] },
    async proposeFaction({ clock }) { return { summary: 'The Moth Court finds another route.', assumptions: 'The western gate remains open.', proposedProgress: Math.min(clock.segments, clock.progress + 1) } },
  }
  const canonExtractor = { version: 'fixture:canon-v1', async extract({ messages }) { return [{ kind: 'fact', title: 'Prepared fact', claim: 'The western gate is open.', visibility: 'gm_only', confidence: 0.9, sources: [{ messageId: messages[0].id, excerpt: 'western gate' }] }] } }
  const continuityGenerator = { version: 'fixture:continuity-v1', async generate({ messages }) { return [{ title: 'Western gate', summary: 'The gate remains open.', whyItMatters: 'The Moth Court may pass.', confidence: 0.8, sources: [{ messageId: messages[0].id, excerpt: 'western gate' }] }] } }
  const recapGenerator = { version: 'fixture:recap-v1', async generate({ messages }) { return { publicSummary: 'The party opened the western gate.', gmNotes: 'The Moth Court noticed.', sources: [{ messageId: messages[0].id, excerpt: 'western gate' }] } } }
  const app = createRoomServer({ databasePath: join(directory, 'table.sqlite'), campaignIntelligence: intelligence, canonExtractor, continuityGenerator, recapGenerator })
  const port = await app.listen(0)
  const origin = `http://127.0.0.1:${port}`
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }) })

  const created = await json(`${origin}/api/campaigns`, { method: 'POST', body: JSON.stringify({ campaignName: 'The Salt Road', playerName: 'Mara' }) })
  const joined = await json(`${origin}/api/invitations/${created.body.campaign.inviteCode}/join`, { method: 'POST', body: JSON.stringify({ playerName: 'Theo' }) })
  const ownerHeaders = { authorization: `Bearer ${created.body.player.token}` }
  const guestHeaders = { authorization: `Bearer ${joined.body.player.token}` }
  const campaignId = created.body.campaign.id
  const roomId = created.body.campaign.rooms[0].id
  const messages = []
  for (let index = 0; index < 20; index += 1) messages.push(app.store.addMessage({ roomId, playerId: created.body.player.id, clientMessageId: `evidence-${index}`, text: `The western gate fact ${index} is established.` }).message)
  const closed = app.store.closeCampaignSession(campaignId, created.body.player.id, 'The western gate').sessions[0]

  for (let index = 0; index < 20; index += 1) {
    const proposal = app.store.createCanonProposal({ campaignId, playerId: created.body.player.id, kind: 'fact', title: `Fact ${index}`, claim: `Established fact number ${index}.`, visibility: 'gm_only', confidence: 0.9, extractorVersion: 'fixture:evidence-v1', sources: [{ messageId: messages[index].id }] }).proposal
    app.store.decideCanonProposal(campaignId, created.body.player.id, proposal.id, { action: 'accept', reason: 'Confirmed.', visibility: index === 0 ? 'campaign' : 'gm_only' })
  }
  const brief = app.store.createContinuityBrief({ campaignId, playerId: created.body.player.id, generatorVersion: 'fixture:evidence-v1', session: closed, threads: Array.from({ length: 10 }, (_, index) => ({ title: `Thread ${index}`, summary: `Thread summary ${index}.`, whyItMatters: 'It remains open.', confidence: 0.8, sources: [{ messageId: messages[index].id }] })) }).brief
  for (const thread of brief.threads) app.store.recordContinuityFeedback(campaignId, created.body.player.id, thread.id, 'useful')

  assert.equal((await json(`${origin}/api/campaign/intelligence`, { headers: guestHeaders })).status, 403)
  const settings = await json(`${origin}/api/campaign/intelligence/settings`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ autoPrepare: true, tasks: { canon: true, continuity: true, recap: true } }) })
  assert.equal(settings.status, 200)
  assert.equal(settings.body.readiness.eligible, true)

  const prepared = await json(`${origin}/api/campaign/intelligence/preparation`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.equal(prepared.status, 202)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })
    if (state.body.preparationRuns[0].status === 'complete') break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal((await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })).body.preparationRuns[0].status, 'complete')
  const duplicatePreparation = await json(`${origin}/api/campaign/intelligence/preparation`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.equal(duplicatePreparation.status, 200)
  assert.equal((await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })).body.preparationRuns.filter((run) => run.sessionId === closed.id).length, 1)

  app.store.addMessage({ roomId, playerId: created.body.player.id, clientMessageId: 'scheduled-session-message', text: 'The western gate opens again.' })
  const scheduledSession = await json(`${origin}/api/campaign/sessions/close`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ title: 'The gate opens again' }) })
  assert.equal(scheduledSession.status, 201)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })
    if (state.body.preparationRuns.some((run) => run.sessionId === scheduledSession.body.sessions[0].id && run.status === 'complete')) break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal((await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })).body.preparationRuns.some((run) => run.sessionId === scheduledSession.body.sessions[0].id && run.status === 'complete'), true)

  const knowledge = await json(`${origin}/api/campaign/intelligence/knowledge`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ question: 'Who keeps the light?' }) })
  assert.equal(knowledge.status, 200)
  assert.equal(knowledge.body.citations[0].visibility, 'campaign')
  assert.equal(knowledge.body.generatorVersion, 'fixture:intelligence-v1')
  const knowledgeFeedback = await json(`${origin}/api/campaign/intelligence/knowledge/${knowledge.body.answerId}/feedback`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ rating: 'incomplete' }) })
  assert.equal(knowledgeFeedback.status, 201)
  assert.equal((await json(`${origin}/api/campaign/intelligence/knowledge/${knowledge.body.answerId}/feedback`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ rating: 'useful' }) })).status, 404)
  await json(`${origin}/api/campaign/intelligence/knowledge`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ question: 'What remains unclear?' }) })
  assert.deepEqual(latestKnowledgeFeedback, [{ question: 'Who keeps the light?', rating: 'incomplete', generatorVersion: 'fixture:intelligence-v1' }])
  assert.equal((await json(`${origin}/api/campaign/intelligence`, { headers: ownerHeaders })).body.knowledgeMetrics[0].incomplete, 1)
  const intent = await json(`${origin}/api/campaign/intelligence/intent`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ intent: 'Signal the party.' }) })
  assert.equal(intent.body.drafts.length, 2)

  const rule = await json(`${origin}/api/campaign/intelligence/rules`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ title: 'Lantern search', sourceRule: 'Core perception rule.', interpretation: 'Bright light reveals marks.', ruling: 'Careful searches gain advantage.', reason: 'Table agreement.' }) })
  assert.equal(rule.status, 201)
  assert.equal((await json(`${origin}/api/campaign/intelligence/rules`, { headers: guestHeaders })).body.rules.length, 1)

  const faction = await json(`${origin}/api/campaign/intelligence/factions`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Moth Court', goal: 'Open the archive', progress: 1, segments: 6 }) })
  const factionProposal = await json(`${origin}/api/campaign/intelligence/factions/${faction.body.clock.id}/proposals`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.equal(factionProposal.status, 201)
  const decision = await json(`${origin}/api/campaign/intelligence/faction-proposals/${factionProposal.body.clock.proposals[0].id}/decision`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ action: 'accept' }) })
  assert.equal(decision.body.clocks[0].progress, 2)

  await json(`${origin}/api/campaign/intelligence/spotlight/consent`, { method: 'PUT', headers: guestHeaders, body: JSON.stringify({ enabled: true }) })
  const spotlight = await json(`${origin}/api/campaign/intelligence/spotlight/report`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.deepEqual(spotlight.body.report.participants.map((participant) => participant.name), [])
})
