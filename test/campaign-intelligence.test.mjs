import assert from 'node:assert/strict'
import test from 'node:test'
import { createCampaignIntelligence, CampaignIntelligenceError } from '../server/campaign-intelligence.mjs'
import { createStore } from '../server/store.mjs'

test('campaign intelligence validates citations, private voice drafts, and clock bounds', async () => {
  const intelligence = createCampaignIntelligence({
    version: 'fixture-v1',
    generateKnowledgeAnswer: async () => ({ answer: 'Ilyra keeps the light.', citations: ['canon-1'] }),
    generateIntentDrafts: async () => ({ drafts: ['I raise the lantern.', 'Let the lantern answer.'] }),
    generateFactionProposal: async () => ({ summary: 'The moth court advances.', assumptions: 'The archive remains sealed.', proposedProgress: 3 }),
  })
  assert.deepEqual(await intelligence.answerKnowledge({ question: 'Who keeps the light?', canon: [{ id: 'canon-1' }] }), { answer: 'Ilyra keeps the light.', citations: ['canon-1'] })
  assert.equal((await intelligence.draftIntent({ intent: 'signal', messages: [], canon: [] })).length, 2)
  assert.equal((await intelligence.proposeFaction({ clock: { segments: 6 }, messages: [], canon: [] })).proposedProgress, 3)

  const leaking = createCampaignIntelligence({
    version: 'fixture-v1',
    generateKnowledgeAnswer: async () => ({ answer: 'A secret.', citations: ['hidden'] }),
    generateIntentDrafts: async () => ({ drafts: [] }),
    generateFactionProposal: async () => ({ summary: 'Too far.', assumptions: 'None.', proposedProgress: 9 }),
  })
  await assert.rejects(() => leaking.answerKnowledge({ question: 'Secret?', canon: [{ id: 'visible' }] }), (error) => error instanceof CampaignIntelligenceError && error.code === 'invalid_knowledge_answer')
  await assert.rejects(() => leaking.draftIntent({ intent: 'speak', messages: [], canon: [] }), /invalid drafts/i)
  await assert.rejects(() => leaking.proposeFaction({ clock: { segments: 6 }, messages: [], canon: [] }), /clock boundary/i)
})

test('campaign intelligence records reversible rulings, proposals, consent, and preparation', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const guest = store.joinCampaign(owner.campaign.inviteCode, 'Theo')
  const roomId = owner.campaign.rooms[0].id
  store.setSpotlightConsent(owner.player.id, true)
  store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'm1', text: 'Mara opens the western gate.' })
  store.addMessage({ roomId, playerId: guest.player.id, clientMessageId: 'm2', text: 'Theo follows the moth sigil.' })
  const session = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'The western gate').sessions[0]

  assert.deepEqual(store.getIntelligenceSettings(owner.campaign.id).tasks, { canon: true, continuity: true, recap: true })
  assert.equal(store.updateIntelligenceSettings(owner.campaign.id, owner.player.id, { autoPrepare: true, tasks: { canon: true, continuity: false, recap: true } }).autoPrepare, true)
  const requestedTasks = { canon: true, continuity: false, recap: true }
  const run = store.queuePreparationRun(owner.campaign.id, session.id, owner.player.id, requestedTasks)
  assert.equal(run.status, 'queued')
  assert.equal(store.queuePreparationRun(owner.campaign.id, session.id, owner.player.id, requestedTasks).id, run.id)
  store.startPreparationTask(owner.campaign.id, run.id, 'canon')
  store.finishPreparationTask(owner.campaign.id, run.id, 'canon', { status: 'complete', result: { proposed: 2 } })
  store.startPreparationTask(owner.campaign.id, run.id, 'recap')
  const completedRun = store.finishPreparationTask(owner.campaign.id, run.id, 'recap', { status: 'complete', result: { id: 'recap-1' } })
  assert.equal(completedRun.status, 'complete')
  assert.deepEqual(completedRun.tasks.find((task) => task.name === 'canon').result, { proposed: 2 })

  const rule = store.createHouseRule(owner.campaign.id, owner.player.id, {
    title: 'Lantern advantage', sourceRule: 'Core test rule', interpretation: 'Bright light reveals the mark.',
    ruling: 'The first search gains advantage.', reason: 'Agreed at the table.',
  })
  const revised = store.reviseHouseRule(owner.campaign.id, owner.player.id, rule.id, {
    title: rule.title, sourceRule: rule.sourceRule, interpretation: rule.interpretation,
    ruling: 'Every careful search gains advantage.', status: 'active', reason: 'Clarified after play.', expectedRevision: 0,
  })
  assert.equal(revised.rule.revision, 1)
  assert.equal(store.listHouseRuleHistory(owner.campaign.id, rule.id).length, 2)
  assert.equal(store.reviseHouseRule(owner.campaign.id, owner.player.id, rule.id, { ...revised.rule, sourceRule: revised.rule.sourceRule, interpretation: revised.rule.interpretation, ruling: revised.rule.ruling, reason: 'stale', expectedRevision: 0 }).outcome, 'conflict')

  const clock = store.createFactionClock(owner.campaign.id, owner.player.id, { name: 'Moth Court', goal: 'Open the archive', progress: 1, segments: 6 })
  const proposed = store.createFactionProposal(owner.campaign.id, owner.player.id, clock.id, { summary: 'Agents find a second key.', assumptions: 'The party keeps the first.', proposedProgress: 3, generatorVersion: 'fixture-v1' })
  const proposalId = proposed.proposals[0].id
  assert.equal(store.decideFactionProposal(owner.campaign.id, owner.player.id, proposalId, 'accept').clocks[0].progress, 3)

  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, session.id).participants.map((item) => item.name), ['Mara'])
  store.setSpotlightConsent(guest.player.id, true)
  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, session.id).participants.map((item) => item.name), ['Mara'])
  store.addMessage({ roomId, playerId: guest.player.id, clientMessageId: 'm3', text: 'Theo speaks after opting in.' })
  const later = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'After consent').sessions[0]
  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, later.id).participants.map((item) => item.name), ['Theo'])
  store.close()
})
