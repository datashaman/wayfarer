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
