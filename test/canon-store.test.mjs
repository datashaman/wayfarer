import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from '../server/store.mjs'

function seededStore() {
  const store = createStore(':memory:')
  const owner = store.createCampaign('The Salt Road', 'Mara')
  const roomId = owner.campaign.rooms[0].id
  const first = store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'message-1', text: 'The lighthouse keeper is called Ilyra.' }).message
  const second = store.addMessage({ roomId, playerId: owner.player.id, clientMessageId: 'message-2', text: 'We promised to return before moonrise.' }).message
  return { store, owner, first, second }
}

test('canon scan coverage advances through transcript messages without skipping new play', () => {
  const { store, owner, first, second } = seededStore()

  assert.deepEqual(store.getCanonCoverage(owner.campaign.id), {
    lastScannedSequence: 0,
    latestSequence: second.sequence,
    unscannedCount: 2,
    lastScannedAt: null,
  })
  assert.deepEqual(store.listUnscannedCampaignMessages(owner.campaign.id).map((message) => message.id), [first.id, second.id])

  store.markCanonScanned(owner.campaign.id, owner.player.id, first.sequence)
  assert.equal(store.getCanonCoverage(owner.campaign.id).unscannedCount, 1)
  assert.deepEqual(store.listUnscannedCampaignMessages(owner.campaign.id).map((message) => message.id), [second.id])

  store.markCanonScanned(owner.campaign.id, owner.player.id, second.sequence)
  assert.equal(store.getCanonCoverage(owner.campaign.id).unscannedCount, 0)
  store.close()
})

test('canon proposals retain campaign-scoped transcript citations', () => {
  const { store, owner, first, second } = seededStore()
  const other = store.createCampaign('The Glass Sea', 'Orin')
  const otherMessage = store.addMessage({
    roomId: other.campaign.rooms[0].id,
    playerId: other.player.id,
    clientMessageId: 'other-message',
    text: 'This belongs to another campaign.',
  }).message

  const created = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'promise',
    title: 'Return before moonrise',
    claim: 'The party promised to return to Ilyra before moonrise.',
    visibility: 'gm_only',
    confidence: 0.84,
    extractorVersion: 'fixture-v1',
    sources: [{ messageId: first.id }, { messageId: second.id, excerpt: 'promised to return' }],
  })

  assert.equal(created.outcome, 'created')
  assert.equal(created.proposal.status, 'proposed')
  assert.deepEqual(created.proposal.sources.map((source) => source.messageId), [first.id, second.id])
  assert.equal(store.createCanonProposal({
    campaignId: owner.campaign.id,
    kind: 'fact',
    title: 'Leaked fact',
    claim: 'A fact from another table.',
    visibility: 'campaign',
    extractorVersion: 'fixture-v1',
    sources: [{ messageId: otherMessage.id }],
  }).outcome, 'invalid_source')
  assert.equal(store.createCanonProposal({
    campaignId: owner.campaign.id,
    kind: 'fact',
    title: 'Unsupported fact',
    claim: 'No transcript support.',
    visibility: 'campaign',
    extractorVersion: 'fixture-v1',
    sources: [],
  }).outcome, 'sources_required')

  store.close()
})

test('canon review is append-only and acceptance creates a human-authored entry', () => {
  const { store, owner, first } = seededStore()
  const created = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'character',
    title: 'The lighthouse keeper',
    claim: 'The lighthouse keeper is called Ilyra.',
    visibility: 'campaign',
    confidence: 0.97,
    extractorVersion: 'fixture-v1',
    sources: [{ messageId: first.id }],
  })

  const accepted = store.decideCanonProposal(owner.campaign.id, owner.player.id, created.proposal.id, {
    action: 'edit_accept',
    title: 'Ilyra, lighthouse keeper',
    claim: 'Ilyra keeps the lighthouse on the Salt Road.',
    visibility: 'campaign',
  })
  assert.equal(accepted.outcome, 'accepted')
  assert.deepEqual(store.listCanonDecisionExamples(owner.campaign.id).map((decision) => ({ action: decision.action, accepted: decision.accepted })), [{
    action: 'edit_accept',
    accepted: { title: 'Ilyra, lighthouse keeper', claim: 'Ilyra keeps the lighthouse on the Salt Road.', visibility: 'campaign' },
  }])
  assert.equal(store.decideCanonProposal(owner.campaign.id, owner.player.id, created.proposal.id, { action: 'reject' }).outcome, 'already_decided')
  assert.deepEqual(store.listCanonEntries(owner.campaign.id).map((entry) => ({ title: entry.title, claim: entry.claim, visibility: entry.visibility, revision: entry.revision })), [{
    title: 'Ilyra, lighthouse keeper',
    claim: 'Ilyra keeps the lighthouse on the Salt Road.',
    visibility: 'campaign',
    revision: 0,
  }])

  store.close()
})

test('canon revisions preserve supersession and retraction history', () => {
  const { store, owner, first } = seededStore()
  const proposal = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'character',
    title: 'Ilyra',
    claim: 'Ilyra keeps the lighthouse.',
    visibility: 'gm_only',
    confidence: 0.9,
    extractorVersion: 'fixture-v1',
    sources: [{ messageId: first.id }],
  }).proposal
  store.decideCanonProposal(owner.campaign.id, owner.player.id, proposal.id, { action: 'accept', visibility: 'campaign' })
  const entry = store.listCanonEntries(owner.campaign.id)[0]

  const revised = store.reviseCanonEntry(owner.campaign.id, owner.player.id, entry.id, {
    action: 'revised', title: 'Ilyra of the Salt Road', claim: 'Ilyra keeps the western lighthouse.',
    visibility: 'campaign', reason: 'Clarified the location.', expectedRevision: 0,
  })
  assert.equal(revised.entry.revision, 1)
  assert.equal(store.reviseCanonEntry(owner.campaign.id, owner.player.id, entry.id, {
    action: 'revised', title: 'Stale edit', claim: 'This should not save.', visibility: 'campaign', expectedRevision: 0,
  }).outcome, 'conflict')
  const superseded = store.reviseCanonEntry(owner.campaign.id, owner.player.id, entry.id, {
    action: 'superseded', title: 'Ilyra of the Glass Coast', claim: 'Ilyra now keeps the eastern lighthouse.',
    visibility: 'campaign', reason: 'The campaign advanced two years.', expectedRevision: 1,
  })
  assert.equal(superseded.entry.revision, 2)

  const retracted = store.retractCanonEntry(owner.campaign.id, owner.player.id, entry.id, { reason: 'The table retconned Ilyra.', expectedRevision: 2 })
  assert.equal(retracted.entry.status, 'retracted')
  assert.equal(store.listCanonEntries(owner.campaign.id).length, 0)
  const history = store.listCanonEntryHistory(owner.campaign.id, entry.id)
  assert.deepEqual(history.revisions.map((revision) => revision.action), ['retracted', 'superseded', 'revised', 'accepted'])
  assert.equal(history.revisions[1].reason, 'The campaign advanced two years.')
  assert.equal(history.entry.sources[0].messageId, first.id)

  store.close()
})

test('continuity briefs retain cited threads and append owner feedback', () => {
  const { store, owner, second } = seededStore()
  const created = store.createContinuityBrief({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    generatorVersion: 'fixture-continuity-v1',
    threads: [{ title: 'Return before moonrise', summary: 'The party promised to return.', whyItMatters: 'The promise remains unresolved.', confidence: 0.9, sources: [{ messageId: second.id, excerpt: 'promised to return' }] }],
  })
  assert.equal(created.outcome, 'created')
  assert.equal(created.brief.threads[0].sources[0].messageId, second.id)
  assert.equal(created.brief.threads[0].feedback, null)
  const rated = store.recordContinuityFeedback(owner.campaign.id, owner.player.id, created.brief.threads[0].id, 'useful')
  assert.equal(rated.threads[0].feedback.rating, 'useful')
  assert.equal(store.recordContinuityFeedback(owner.campaign.id, owner.player.id, 'unknown-thread', 'useful'), null)
  store.close()
})
