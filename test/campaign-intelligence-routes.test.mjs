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
    async proposeFaction({ clock, messages }) { return { summary: 'The Moth Court finds another route.', assumptions: 'The western gate remains open.', proposedProgress: Math.min(clock.segments, clock.progress + 1), citations: [messages[0].id] } },
    async compileHouseRule({ messages }) { return { title: 'Gate test', sourceRule: 'Core test rule.', interpretation: 'The open gate grants leverage.', ruling: 'Gate searches gain advantage.', citations: [messages[0].id] } },
    async draftCharacterConcepts({ world }) { return Array.from({ length: 3 }, (_, index) => ({ name: `Wayfarer ${index + 1}`, concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find a lost sibling.', capability: 'Knows hidden crossings.', complication: 'The bell knows their oath.', possession: 'A wet iron key.', belief: 'No debt survives truth.', secret: 'They rang the bell before.', factionId: world.factions[0].id, factionConnection: 'They paid for silence.', locationId: world.locations[0].id, locationConnection: 'They drowned there.', npcId: world.npcs[0].id, npcConnection: 'The Witness knows what they did.', generatorVersion: this.version })) },
    async draftCampaignSeed({ premise }) { return { title: 'The Drowned Bell', premise, pitch: 'A drowned town returns for seven nights.', truths: [{ text: 'The bell remembers every oath.' }, { text: 'The streets flood at dawn.' }, { text: 'No map agrees.' }], factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths will surface.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'The town frees their enemies.' }], locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'The bell punishes lies.' }, { name: 'Tilted Inn', description: 'A leaning refuge.', danger: 'The foundations move.' }, { name: 'Salt Archive', description: 'A library of salt.', danger: 'Names wake their owners.' }], npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A true name.', leverage: 'A safe route.' })), hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A dangerous bargain.' })), openingCrisis: { title: 'The first toll', situation: 'The bell rings untouched.', stakes: 'The town sinks at the seventh toll.' }, generatorVersion: this.version } },
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
  assert.equal((await json(`${origin}/api/campaign/world`, { headers: guestHeaders })).status, 403)
  const worldDraft = await json(`${origin}/api/campaign/world/draft`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ premise: 'A drowned town returns for seven nights.' }) })
  assert.equal(worldDraft.status, 200)
  assert.equal(worldDraft.body.draft.npcs.length, 5)
  const savedWorld = await json(`${origin}/api/campaign/world`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify(worldDraft.body.draft) })
  assert.equal(savedWorld.status, 201)
  assert.equal(savedWorld.body.world.openingCrisis.title, 'The first toll')
  const characterContext = await json(`${origin}/api/campaign/characters`, { headers: guestHeaders })
  assert.equal(characterContext.status, 200)
  assert.equal(characterContext.body.world.factions[0].opposition, undefined)
  const concepts = await json(`${origin}/api/campaign/characters/concepts`, { method: 'POST', headers: guestHeaders })
  assert.equal(concepts.status, 200)
  assert.equal(concepts.body.concepts.length, 3)
  const savedCharacter = await json(`${origin}/api/campaign/characters/mine`, { method: 'POST', headers: guestHeaders, body: JSON.stringify(concepts.body.concepts[0]) })
  assert.equal(savedCharacter.status, 201)
  assert.equal(savedCharacter.body.character.secret, 'They rang the bell before.')
  const ownerCharacterView = await json(`${origin}/api/campaign/characters`, { headers: ownerHeaders })
  assert.equal(ownerCharacterView.body.characters[0].secret, 'They rang the bell before.')
  const revisedWorld = await json(`${origin}/api/campaign/world`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ ...savedWorld.body.world, pitch: 'The seventh toll is tonight.', expectedRevision: 0 }) })
  assert.equal(revisedWorld.status, 200)
  assert.equal(revisedWorld.body.world.revision, 1)
  assert.equal((await json(`${origin}/api/campaign/world`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ ...savedWorld.body.world, expectedRevision: 0 }) })).status, 409)
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

  const ruleEvidence = await json(`${origin}/api/campaign/intelligence/rules/evidence?sessionId=${closed.id}`, { headers: ownerHeaders })
  assert.equal(ruleEvidence.body.messages.length, 20)
  const compiledRule = await json(`${origin}/api/campaign/intelligence/rules/compile`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id, messageIds: [ruleEvidence.body.messages[0].messageId] }) })
  assert.equal(compiledRule.status, 201)
  assert.equal(compiledRule.body.proposal.sources[0].messageId, messages[0].id)
  assert.equal(compiledRule.body.proposal.generatorVersion, 'fixture:intelligence-v1')
  const ruleDecision = await json(`${origin}/api/campaign/intelligence/rules/proposals/${compiledRule.body.proposal.id}/decision`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ action: 'accept', reason: 'Table agreement.', ...compiledRule.body.proposal.original, ruling: 'Gate searches gain advantage after a careful approach.' }) })
  assert.equal(ruleDecision.status, 200)
  assert.equal(ruleDecision.body.proposal.decision.action, 'edit_accept')
  assert.deepEqual(ruleDecision.body.proposal.decision.editedFields, ['ruling'])
  assert.equal(ruleDecision.body.rule.sources[0].messageId, messages[0].id)
  const ruleLedger = await json(`${origin}/api/campaign/intelligence/rules`, { headers: guestHeaders })
  assert.equal(ruleLedger.body.rules.length, 1)
  assert.deepEqual(ruleLedger.body.proposals, [])

  const faction = await json(`${origin}/api/campaign/intelligence/factions`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Moth Court', goal: 'Open the archive', progress: 1, segments: 6 }) })
  const factionProposal = await json(`${origin}/api/campaign/intelligence/factions/${faction.body.clock.id}/proposals`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.equal(factionProposal.status, 201)
  assert.deepEqual({ from: factionProposal.body.clock.proposals[0].baseProgress, to: factionProposal.body.clock.proposals[0].proposedProgress }, { from: 1, to: 2 })
  assert.equal(factionProposal.body.clock.proposals[0].sources[0].messageId, messages[0].id)
  const decision = await json(`${origin}/api/campaign/intelligence/faction-proposals/${factionProposal.body.clock.proposals[0].id}/decision`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ action: 'accept' }) })
  assert.equal(decision.body.clocks[0].progress, 2)
  assert.equal(decision.body.clocks[0].proposals[0].status, 'accepted')

  await json(`${origin}/api/campaign/intelligence/spotlight/consent`, { method: 'PUT', headers: guestHeaders, body: JSON.stringify({ enabled: true }) })
  const spotlight = await json(`${origin}/api/campaign/intelligence/spotlight/report`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: closed.id }) })
  assert.deepEqual(spotlight.body.report.participants.map((participant) => participant.name), [])
  app.store.addMessage({ roomId, playerId: joined.body.player.id, clientMessageId: 'consented-spotlight-message', text: 'Theo offers a route through the gate.' })
  const consentSession = app.store.closeCampaignSession(campaignId, created.body.player.id, 'After spotlight consent').sessions[0]
  await json(`${origin}/api/campaign/intelligence/spotlight/report`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ sessionId: consentSession.id }) })
  let guestConsent = await json(`${origin}/api/campaign/intelligence/spotlight/consent`, { headers: guestHeaders })
  assert.deepEqual(guestConsent.body.consent.reports.map((report) => report.session.title), ['After spotlight consent'])
  await json(`${origin}/api/campaign/intelligence/spotlight/consent`, { method: 'PUT', headers: guestHeaders, body: JSON.stringify({ enabled: false }) })
  guestConsent = await json(`${origin}/api/campaign/intelligence/spotlight/consent`, { headers: guestHeaders })
  assert.deepEqual(guestConsent.body.consent.history.map((event) => event.enabled), [false, true])
  assert.equal(guestConsent.body.consent.reports.length, 1)
})
