import assert from 'node:assert/strict'
import test from 'node:test'
import { createCampaignIntelligence, CampaignIntelligenceError } from '../server/campaign-intelligence.mjs'
import { createStore } from '../server/store.mjs'

const campaignSeed = {
  title: 'The Drowned Bell', pitch: 'A drowned town resurfaces for one moonless week.',
  truths: ['The bell remembers every oath.', 'The streets flood at dawn.', 'No map agrees with the town.'],
  factions: [
    { name: 'The Salvagers', goal: 'Raise the bell.', opposition: 'The bell exposes their broken oaths.' },
    { name: 'The Tidebound', goal: 'Sink the town forever.', opposition: 'The resurfacing frees their enemies.' },
  ],
  locations: [
    { name: 'Bell Square', description: 'A plaza under black water.', danger: 'The bell tolls when someone lies.' },
    { name: 'The Tilted Inn', description: 'A refuge balanced against a tower.', danger: 'Its foundations move with the tide.' },
    { name: 'Salt Archive', description: 'Records pressed into salt tablets.', danger: 'Reading a name wakes its owner.' },
  ],
  npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper of a lost oath', want: 'Recover a true name.', leverage: 'Knows one safe street.' })),
  hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'Someone offers a dangerous bargain.' })),
  openingCrisis: { title: 'The first toll', situation: 'The bell rings before anyone touches it.', stakes: 'At the seventh toll, the town sinks.' },
}

test('campaign intelligence validates citations, private voice drafts, and clock bounds', async () => {
  const intelligence = createCampaignIntelligence({
    version: 'fixture-v1',
    generateKnowledgeAnswer: async () => ({ answer: 'Ilyra keeps the light.', citations: ['canon-1'] }),
    generateIntentDrafts: async () => ({ drafts: ['I raise the lantern.', 'Let the lantern answer.'] }),
    generateFactionProposal: async () => ({ summary: 'The moth court advances.', assumptions: 'The archive remains sealed.', proposedProgress: 3, citations: ['message-1'] }),
    generateHouseRule: async () => ({ title: 'Lantern test', sourceRule: 'Core test rule.', interpretation: 'Bright light helps.', ruling: 'Gain advantage.', citations: ['message-1'] }),
    generateCampaignSeed: async () => campaignSeed,
  })
  assert.deepEqual(await intelligence.answerKnowledge({ question: 'Who keeps the light?', canon: [{ id: 'canon-1' }] }), { answer: 'Ilyra keeps the light.', citations: ['canon-1'] })
  assert.equal((await intelligence.draftIntent({ intent: 'signal', messages: [], canon: [] })).length, 2)
  assert.equal((await intelligence.proposeFaction({ clock: { segments: 6 }, messages: [{ id: 'message-1' }], canon: [] })).proposedProgress, 3)
  assert.equal((await intelligence.compileHouseRule({ messages: [{ id: 'message-1' }] })).citations[0], 'message-1')
  assert.equal((await intelligence.draftCampaignSeed({ premise: 'A drowned town returns.' })).npcs.length, 5)

  const leaking = createCampaignIntelligence({
    version: 'fixture-v1',
    generateKnowledgeAnswer: async () => ({ answer: 'A secret.', citations: ['hidden'] }),
    generateIntentDrafts: async () => ({ drafts: [] }),
    generateFactionProposal: async () => ({ summary: 'Too far.', assumptions: 'None.', proposedProgress: 9, citations: ['hidden'] }),
    generateHouseRule: async () => ({ title: 'Hidden', sourceRule: 'Rule', interpretation: 'Guess', ruling: 'Do it', citations: ['hidden'] }),
    generateCampaignSeed: async () => ({ ...campaignSeed, hooks: [] }),
  })
  await assert.rejects(() => leaking.answerKnowledge({ question: 'Secret?', canon: [{ id: 'visible' }] }), (error) => error instanceof CampaignIntelligenceError && error.code === 'invalid_knowledge_answer')
  await assert.rejects(() => leaking.draftIntent({ intent: 'speak', messages: [], canon: [] }), /invalid drafts/i)
  await assert.rejects(() => leaking.proposeFaction({ clock: { segments: 6 }, messages: [], canon: [] }), /clock boundary/i)
  await assert.rejects(() => leaking.compileHouseRule({ messages: [{ id: 'visible' }] }), /selected transcript/i)
  await assert.rejects(() => leaking.draftCampaignSeed({ premise: 'Anything.' }), /complete playable opening/i)
})

test('campaign intelligence records reversible rulings, proposals, consent, and preparation', () => {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const guest = store.joinCampaign(owner.campaign.inviteCode, 'Theo')
  const roomId = owner.campaign.rooms[0].id
  store.setSpotlightConsent(owner.player.id, true)
  const firstMessage = store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'm1', text: 'Mara opens the western gate.' }).message
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

  const ruleProposal = store.createHouseRuleProposal(owner.campaign.id, owner.player.id, {
    sessionId: session.id, generatorVersion: 'fixture-v1', title: 'Lantern advantage', sourceRule: 'Core test rule',
    interpretation: 'Bright light reveals the mark.', ruling: 'The first search gains advantage.', sources: [{ messageId: firstMessage.id }],
  })
  assert.equal(ruleProposal.status, 'proposed')
  assert.equal(ruleProposal.generatorVersion, 'fixture-v1')
  const acceptedProposal = store.decideHouseRuleProposal(owner.campaign.id, owner.player.id, ruleProposal.id, {
    action: 'accept', reason: 'Clarified before recording.', title: ruleProposal.original.title, sourceRule: ruleProposal.original.sourceRule,
    interpretation: ruleProposal.original.interpretation, ruling: 'Every careful search gains advantage.',
  })
  assert.equal(acceptedProposal.outcome, 'accepted')
  assert.equal(acceptedProposal.proposal.decision.action, 'edit_accept')
  assert.deepEqual(acceptedProposal.proposal.decision.editedFields, ['ruling'])
  assert.equal(acceptedProposal.proposal.original.ruling, 'The first search gains advantage.')
  assert.equal(acceptedProposal.rule.ruling, 'Every careful search gains advantage.')
  const rejectedProposal = store.createHouseRuleProposal(owner.campaign.id, owner.player.id, {
    sessionId: session.id, generatorVersion: 'fixture-v2', title: 'Noisy ruling', sourceRule: 'A source',
    interpretation: 'An interpretation', ruling: 'An unwanted ruling', sources: [{ messageId: firstMessage.id }],
  })
  assert.equal(store.decideHouseRuleProposal(owner.campaign.id, owner.player.id, rejectedProposal.id, { action: 'reject', reason: 'Not how this table plays.' }).proposal.decision.action, 'reject')
  assert.equal(store.decideHouseRuleProposal(owner.campaign.id, owner.player.id, rejectedProposal.id, { action: 'reject', reason: 'Again.' }).outcome, 'conflict')
  const ruleFeedback = store.exportAiFeedback(owner.campaign.id).houseRules
  assert.deepEqual(ruleFeedback.map((fixture) => fixture.decision.action), ['edit_accept', 'reject'])
  assert.equal(ruleFeedback[0].proposal.ruling, 'The first search gains advantage.')
  assert.equal(ruleFeedback[0].decision.accepted.ruling, 'Every careful search gains advantage.')

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
  const proposed = store.createFactionProposal(owner.campaign.id, owner.player.id, clock.id, { summary: 'Agents find a second key.', assumptions: 'The party keeps the first.', proposedProgress: 3, generatorVersion: 'fixture-v1', sessionId: session.id, sources: [{ messageId: firstMessage.id }] })
  const proposalId = proposed.proposals[0].id
  assert.deepEqual({ from: proposed.proposals[0].baseProgress, to: proposed.proposals[0].proposedProgress }, { from: 1, to: 3 })
  assert.equal(proposed.proposals[0].sources[0].messageId, firstMessage.id)
  assert.equal(store.decideFactionProposal(owner.campaign.id, owner.player.id, proposalId, 'accept').clocks[0].progress, 3)

  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, owner.player.id, session.id).participants.map((item) => item.name), ['Mara'])
  store.setSpotlightConsent(guest.player.id, true)
  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, owner.player.id, session.id).participants.map((item) => item.name), ['Mara'])
  store.addMessage({ roomId, playerId: guest.player.id, clientMessageId: 'm3', text: 'Theo speaks after opting in.' })
  const later = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'After consent').sessions[0]
  assert.deepEqual(store.createSpotlightReport(owner.campaign.id, owner.player.id, later.id).participants.map((item) => item.name), ['Theo'])
  store.setSpotlightConsent(guest.player.id, false)
  assert.equal(store.getSpotlightConsent(guest.player.id).history.length, 2)
  assert.deepEqual(store.listSpotlightReportsForPlayer(guest.player.id).map((report) => report.session.title), ['After consent'])
  store.close()
})
