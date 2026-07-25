import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreparationWorker } from '../server/preparation-worker.mjs'
import { createStore } from '../server/store.mjs'

async function waitFor(read, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Timed out waiting for preparation worker.')
}

test('preparation resumes interrupted tasks and retries only failures without duplicate artifacts', async (t) => {
  const store = createStore(':memory:')
  t.after(() => store.close())
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const roomId = owner.campaign.rooms[0].id
  const message = store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'prep-evidence', text: 'The western gate remains open.' }).message
  const session = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'The western gate').sessions[0]
  const run = store.queuePreparationRun(owner.campaign.id, session.id, owner.player.id, { canon: false, continuity: true, recap: true })

  store.startPreparationTask(owner.campaign.id, run.id, 'continuity')
  let continuityAttempts = 0
  const worker = createPreparationWorker({
    store,
    continuityGenerator: {
      version: 'fixture:continuity-v1',
      async generate() {
        continuityAttempts += 1
        if (continuityAttempts === 1) throw new Error('Temporary continuity failure.')
        return [{ title: 'Western gate', summary: 'The gate remains open.', whyItMatters: 'The court can pass.', confidence: 0.8, sources: [{ messageId: message.id }] }]
      },
    },
    recapGenerator: {
      version: 'fixture:recap-v1',
      async generate() { return { publicSummary: 'The gate opened.', gmNotes: 'The court noticed.', sources: [{ messageId: message.id }] } },
    },
  })

  worker.resume()
  let current = await waitFor(() => store.getPreparationRun(owner.campaign.id, run.id), (value) => value.status === 'failed')
  assert.deepEqual(current.tasks.map(({ name, status, attempts }) => ({ name, status, attempts })), [
    { name: 'continuity', status: 'failed', attempts: 2 },
    { name: 'recap', status: 'complete', attempts: 1 },
  ])
  assert.equal(store.getLatestSessionRecap(owner.campaign.id, { includeDrafts: true }).contextSession.id, session.id)

  worker.retry(owner.campaign.id, run.id)
  current = await waitFor(() => store.getPreparationRun(owner.campaign.id, run.id), (value) => value.status === 'complete')
  assert.deepEqual(current.tasks.map(({ name, status, attempts }) => ({ name, status, attempts })), [
    { name: 'continuity', status: 'complete', attempts: 3 },
    { name: 'recap', status: 'complete', attempts: 1 },
  ])
  assert.equal(current.tasks.find((task) => task.name === 'continuity').result.threads, 1)
  await worker.close()
})

test('preparation runs derive downstream human outcomes from their exact artifacts', (t) => {
  const store = createStore(':memory:')
  t.after(() => store.close())
  const owner = store.createCampaign('The Glass Road', 'Mara')
  const roomId = owner.campaign.rooms[0].id
  const message = store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'outcome-evidence', text: 'The glass gate opens at moonrise.' }).message
  const session = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'The glass gate').sessions[0]
  const run = store.queuePreparationRun(owner.campaign.id, session.id, owner.player.id, { canon: true, continuity: true, recap: true })

  const canon = store.createCanonProposal({ campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'fact', title: 'Glass gate', claim: 'The glass gate opens at moonrise.', visibility: 'gm_only', confidence: 0.9, extractorVersion: 'fixture-v1', sources: [{ messageId: message.id }] }).proposal
  store.startPreparationTask(owner.campaign.id, run.id, 'canon')
  store.finishPreparationTask(owner.campaign.id, run.id, 'canon', { status: 'complete', result: { proposed: 1, artifactIds: [canon.id] } })

  const brief = store.createContinuityBrief({ campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'fixture-v1', preparationRunId: run.id, session, threads: [{ title: 'Moonrise gate', summary: 'The gate is due to open.', whyItMatters: 'The party is waiting.', confidence: 0.8, sources: [{ messageId: message.id }] }] }).brief
  store.startPreparationTask(owner.campaign.id, run.id, 'continuity')
  store.finishPreparationTask(owner.campaign.id, run.id, 'continuity', { status: 'complete', result: { id: brief.id, threads: 1 } })

  const recap = store.createSessionRecap({ campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'fixture-v1', preparationRunId: run.id, session, publicSummary: 'The glass gate opened.', gmNotes: 'Moonrise matters.', sources: [{ messageId: message.id }] }).recap
  store.startPreparationTask(owner.campaign.id, run.id, 'recap')
  store.finishPreparationTask(owner.campaign.id, run.id, 'recap', { status: 'complete', result: { id: recap.id } })

  let outcomes = store.getPreparationRun(owner.campaign.id, run.id).tasks.map((task) => task.outcome)
  assert.deepEqual(outcomes, [
    { total: 1, awaiting: 1, accepted: 0, disputed: 0, rejected: 0 },
    { total: 1, rated: 0, useful: 0, issues: 0 },
    { status: 'draft', revision: 0 },
  ])

  store.decideCanonProposal(owner.campaign.id, owner.player.id, canon.id, { action: 'accept', reason: 'Confirmed.', visibility: 'gm_only' })
  store.recordContinuityFeedback(owner.campaign.id, owner.player.id, brief.threads[0].id, 'useful')
  store.publishSessionRecap(owner.campaign.id, owner.player.id, recap.id)
  outcomes = store.getPreparationRun(owner.campaign.id, run.id).tasks.map((task) => task.outcome)
  assert.equal(outcomes[0].accepted, 1)
  assert.deepEqual(outcomes[1], { total: 1, rated: 1, useful: 1, issues: 0 })
  assert.equal(outcomes[2].status, 'published')
})
