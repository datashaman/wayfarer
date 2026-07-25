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

test('campaign sessions freeze transcript ranges, participants, and canon coverage', () => {
  const { store, owner, first, second } = seededStore()
  const other = store.createCampaign('The Glass Sea', 'Orin')
  store.addMessage({ roomId: other.campaign.rooms[0].id, playerId: other.player.id, clientMessageId: 'other-session-message', text: 'An interleaved message.' })

  let sessions = store.listCampaignSessions(owner.campaign.id)
  assert.equal(sessions[0].id, 'current')
  assert.equal(sessions[0].messageCount, 2)
  assert.deepEqual(sessions[0].participants.map((player) => player.name), ['Mara'])
  assert.equal(sessions[0].canonCoverage, 'unreviewed')
  store.markCanonScanned(owner.campaign.id, owner.player.id, first.sequence)
  assert.equal(store.listCampaignSessions(owner.campaign.id)[0].canonCoverage, 'partial')

  const closed = store.closeCampaignSession(owner.campaign.id, owner.player.id, 'The lighthouse road')
  assert.equal(closed.outcome, 'closed')
  assert.equal(closed.sessions[0].status, 'closed')
  assert.equal(closed.sessions[0].messageCount, 2)
  assert.deepEqual(store.getCampaignSessionMessages(owner.campaign.id, closed.sessions[0].id).messages.map((message) => message.id), [first.id, second.id])
  assert.equal(store.getCampaignSessionMessages(owner.campaign.id, closed.sessions[0].id, 1).truncated, true)

  const third = store.addMessage({ roomId: owner.campaign.rooms[0].id, playerId: owner.player.id, clientMessageId: 'message-3', text: 'A new chapter begins.' }).message
  sessions = store.listCampaignSessions(owner.campaign.id)
  assert.equal(sessions[0].status, 'open')
  assert.equal(sessions[0].messageCount, 1)
  assert.equal(sessions[1].title, 'The lighthouse road')
  store.markCanonScanned(owner.campaign.id, owner.player.id, second.sequence)
  assert.equal(store.listCampaignSessions(owner.campaign.id)[1].canonCoverage, 'reviewed')
  assert.equal(store.getCampaignSessionMessages(owner.campaign.id, 'missing'), null)
  assert.equal(store.closeCampaignSession(owner.campaign.id, owner.player.id, 'New chapter').sessions[0].endSequence, third.sequence)
  store.close()
})

test('canon constitutions keep immutable revision numbers and reject stale edits', () => {
  const { store, owner } = seededStore()
  const initial = store.getCanonConstitution(owner.campaign.id)
  assert.deepEqual({
    canonThreshold: initial.canonThreshold,
    playerDeclarations: initial.playerDeclarations,
    oocPolicy: initial.oocPolicy,
    correctionPolicy: initial.correctionPolicy,
    defaultVisibility: initial.defaultVisibility,
    guidance: initial.guidance,
    revision: initial.revision,
  }, {
    canonThreshold: 'explicit_only', playerDeclarations: 'require_confirmation', oocPolicy: 'exclude',
    correctionPolicy: 'latest_explicit', defaultVisibility: 'gm_only', guidance: '', revision: 0,
  })
  const saved = store.updateCanonConstitution(owner.campaign.id, owner.player.id, {
    canonThreshold: 'table_consensus', playerDeclarations: 'stand_unless_challenged',
    oocPolicy: 'explicit_corrections_only', correctionPolicy: 'flag_conflicts',
    defaultVisibility: 'campaign', guidance: 'Promises spoken in character count.',
  }, 0)
  assert.equal(saved.conflict, false)
  assert.equal(saved.constitution.revision, 1)
  assert.equal(saved.constitution.updatedByName, 'Mara')
  const stale = store.updateCanonConstitution(owner.campaign.id, owner.player.id, {
    canonThreshold: 'played_as_true', playerDeclarations: 'stand_unless_challenged',
    oocPolicy: 'exclude', correctionPolicy: 'latest_explicit', defaultVisibility: 'gm_only', guidance: '',
  }, 0)
  assert.equal(stale.conflict, true)
  assert.equal(stale.constitution.guidance, 'Promises spoken in character count.')
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

test('near-duplicate canon merges pending evidence and suppresses repeated rulings', () => {
  const { store, owner, first, second } = seededStore()
  const initial = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'promise',
    title: 'Return before moonrise',
    claim: 'The party promised to return before moonrise.',
    visibility: 'gm_only',
    confidence: 0.84,
    extractorVersion: 'fixture-v1',
    sources: [{ messageId: first.id }],
  })
  const merged = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'promise',
    title: 'Moonrise return',
    claim: 'Before moonrise, the party promises they will return.',
    visibility: 'gm_only',
    confidence: 0.91,
    extractorVersion: 'fixture-v2',
    sources: [{ messageId: second.id }],
  })

  assert.equal(merged.outcome, 'merged')
  assert.equal(merged.proposal.id, initial.proposal.id)
  assert.deepEqual(merged.proposal.sources.map((source) => source.messageId), [first.id, second.id])
  assert.equal(store.listCanonProposals(owner.campaign.id, { includeGmOnly: true }).length, 1)
  const existing = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'promise',
    title: 'Moonrise return',
    claim: 'Before moonrise, the party promises they will return.',
    visibility: 'gm_only',
    confidence: 0.91,
    extractorVersion: 'fixture-v2',
    sources: [{ messageId: second.id }],
  })
  assert.equal(existing.outcome, 'existing')

  store.decideCanonProposal(owner.campaign.id, owner.player.id, initial.proposal.id, { action: 'reject', reason: 'Already resolved.' })
  const suppressed = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'promise',
    title: 'Return at moonrise',
    claim: 'The party promises to return before moonrise.',
    visibility: 'gm_only',
    confidence: 0.95,
    extractorVersion: 'fixture-v2',
    sources: [{ messageId: second.id }],
  })
  assert.equal(suppressed.outcome, 'suppressed')
  assert.equal(suppressed.matchedStatus, 'rejected')
  assert.deepEqual(store.getCanonProposalMatchMetrics(owner.campaign.id), [{
    extractorVersion: 'fixture-v2', total: 3, existing: 1, merged: 1, suppressed: 1,
  }])
  store.close()
})

test('changed canon claims remain reviewable instead of being deduplicated', () => {
  const { store, owner, first, second } = seededStore()
  const initial = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'character', title: 'Ilyra',
    claim: 'Ilyra keeps the western lighthouse.', visibility: 'gm_only', confidence: 0.8,
    extractorVersion: 'fixture-v1', sources: [{ messageId: first.id }],
  }).proposal
  store.decideCanonProposal(owner.campaign.id, owner.player.id, initial.id, { action: 'accept', visibility: 'gm_only' })

  const represented = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'character', title: 'Ilyra',
    claim: 'Ilyra keeps the western lighthouse.', visibility: 'gm_only', confidence: 0.9,
    extractorVersion: 'fixture-v2', sources: [{ messageId: second.id }],
  })

  const ended = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'character', title: 'Ilyra',
    claim: 'Ilyra no longer keeps the western lighthouse.', visibility: 'gm_only', confidence: 0.9,
    extractorVersion: 'fixture-v2', sources: [{ messageId: second.id }],
  })
  const moved = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'character', title: 'Ilyra',
    claim: 'Ilyra keeps the eastern lighthouse.', visibility: 'gm_only', confidence: 0.9,
    extractorVersion: 'fixture-v2', sources: [{ messageId: second.id }],
  })

  assert.equal(represented.outcome, 'suppressed')
  assert.equal(represented.matchedStatus, 'accepted')
  assert.equal(ended.outcome, 'created')
  assert.equal(moved.outcome, 'created')
  assert.equal(store.listCanonProposals(owner.campaign.id, { includeGmOnly: true }).length, 3)
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

test('character audiences remain private, visible to their seats, and revisioned', () => {
  const { store, owner, first } = seededStore()
  const theo = store.joinCampaign(owner.campaign.inviteCode, 'Theo')
  const nina = store.joinCampaign(owner.campaign.inviteCode, 'Nina')
  const proposal = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'fact', title: 'Theo’s signet',
    claim: 'Theo alone recognizes the royal signet.', visibility: 'gm_only', confidence: 0.9,
    extractorVersion: 'fixture-v1', sources: [{ messageId: first.id }],
  }).proposal
  store.decideCanonProposal(owner.campaign.id, owner.player.id, proposal.id, {
    action: 'accept', visibility: 'characters', audiencePlayerIds: [theo.player.id],
  })
  assert.equal(store.listCanonEntries(owner.campaign.id, { viewerPlayerId: nina.player.id }).length, 0)
  const visible = store.listCanonEntries(owner.campaign.id, { viewerPlayerId: theo.player.id })[0]
  assert.equal(visible.visibility, 'characters')
  assert.deepEqual(visible.audienceNames, ['Theo'])
  const revised = store.reviseCanonEntry(owner.campaign.id, owner.player.id, visible.id, {
    action: 'revised', title: visible.title, claim: 'Theo and Nina recognize the royal signet.',
    visibility: 'characters', audiencePlayerIds: [theo.player.id, nina.player.id], expectedRevision: 0,
  })
  assert.deepEqual(revised.entry.audienceNames, ['Nina', 'Theo'])
  const history = store.listCanonEntryHistory(owner.campaign.id, visible.id, { includeGmOnly: true })
  assert.deepEqual(history.revisions.map((revision) => revision.audienceNames), [['Nina', 'Theo'], ['Theo']])
  assert.equal(store.getCharacterKnowledge(owner.campaign.id, nina.player.id).entries.length, 1)
  store.close()
})

test('contradiction reports preserve canon snapshots and campaign transcript evidence', () => {
  const { store, owner, first, second } = seededStore()
  const proposal = store.createCanonProposal({
    campaignId: owner.campaign.id, playerId: owner.player.id, kind: 'character', title: 'Ilyra',
    claim: 'Ilyra keeps the lighthouse.', visibility: 'gm_only', confidence: 0.9,
    extractorVersion: 'fixture-v1', sources: [{ messageId: first.id }],
  }).proposal
  store.decideCanonProposal(owner.campaign.id, owner.player.id, proposal.id, { action: 'accept', visibility: 'gm_only' })
  const entry = store.listCanonEntries(owner.campaign.id, { includeGmOnly: true })[0]
  const session = store.listCampaignSessions(owner.campaign.id)[0]
  const created = store.createContradictionReport({
    campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'radar-v1',
    session,
    findings: [{ canonEntryId: entry.id, title: 'Promise conflicts', explanation: 'The newer statement denies the accepted account.', confidence: 0.88, sources: [{ messageId: second.id, excerpt: 'promised to return' }] }],
  })
  assert.equal(created.outcome, 'created')
  assert.equal(created.report.findings[0].canonClaim, 'Ilyra keeps the lighthouse.')
  assert.equal(created.report.findings[0].sources[0].messageId, second.id)
  assert.deepEqual(created.report.contextSession, {
    id: 'current', title: 'Current session', status: 'open',
    startSequence: session.startSequence, endSequence: session.endSequence,
  })
  assert.equal(store.createContradictionReport({
    campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'radar-v1',
    findings: [{ canonEntryId: 'unknown', title: 'Invalid', explanation: 'Invalid source.', confidence: 0.5, sources: [{ messageId: second.id }] }],
  }).outcome, 'invalid_source')
  store.close()
})

test('continuity briefs retain cited threads and append owner feedback', () => {
  const { store, owner, second } = seededStore()
  const session = store.listCampaignSessions(owner.campaign.id)[0]
  const created = store.createContinuityBrief({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    generatorVersion: 'fixture-continuity-v1',
    session,
    threads: [{ title: 'Return before moonrise', summary: 'The party promised to return.', whyItMatters: 'The promise remains unresolved.', confidence: 0.9, sources: [{ messageId: second.id, excerpt: 'promised to return' }] }],
  })
  assert.equal(created.outcome, 'created')
  assert.equal(created.brief.threads[0].sources[0].messageId, second.id)
  assert.equal(created.brief.threads[0].feedback, null)
  assert.equal(created.brief.contextSession.endSequence, session.endSequence)
  assert.equal(created.brief.threads[0].lifecycle.status, 'open')
  const resolved = store.transitionContinuityThread(owner.campaign.id, owner.player.id, created.brief.threads[0].id, 'resolved', 'The compass was returned.')
  assert.equal(resolved.threads[0].lifecycle.status, 'resolved')
  assert.equal(resolved.threads[0].lifecycleHistory[0].reason, 'The compass was returned.')
  const rated = store.recordContinuityFeedback(owner.campaign.id, owner.player.id, created.brief.threads[0].id, 'useful')
  assert.equal(rated.threads[0].feedback.rating, 'useful')
  store.recordContinuityFeedback(owner.campaign.id, owner.player.id, created.brief.threads[0].id, 'secret_leak')
  const exported = store.exportAiFeedback(owner.campaign.id)
  assert.deepEqual(exported.continuity.map((fixture) => ({
    generatorVersion: fixture.generatorVersion,
    rating: fixture.feedback.rating,
    text: fixture.thread.sources[0].text,
  })), [{ generatorVersion: 'fixture-continuity-v1', rating: 'secret_leak', text: 'We promised to return before moonrise.' }])
  assert.equal(store.recordContinuityFeedback(owner.campaign.id, owner.player.id, 'unknown-thread', 'useful'), null)
  store.close()
})

test('session recaps remain drafts until a GM publishes them', () => {
  const { store, owner, first } = seededStore()
  const session = store.listCampaignSessions(owner.campaign.id)[0]
  const created = store.createSessionRecap({
    campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'recap-v1', session,
    publicSummary: 'The party met Ilyra.', gmNotes: 'Ilyra remains suspicious.', sources: [{ messageId: first.id }],
  })
  assert.equal(created.recap.status, 'draft')
  assert.equal(store.getLatestSessionRecap(owner.campaign.id), null)
  const published = store.publishSessionRecap(owner.campaign.id, owner.player.id, created.recap.id)
  assert.equal(published.recap.status, 'published')
  assert.equal(store.getLatestSessionRecap(owner.campaign.id).gmNotes, null)
  assert.equal(store.getLatestSessionRecap(owner.campaign.id, { includeGmNotes: true }).gmNotes, 'Ilyra remains suspicious.')
  store.close()
})

test('AI feedback export retains judged model output without human names', () => {
  const { store, owner, first } = seededStore()
  const proposal = store.createCanonProposal({
    campaignId: owner.campaign.id,
    playerId: owner.player.id,
    kind: 'character',
    title: 'The lighthouse keeper',
    claim: 'The lighthouse keeper is called Ilyra.',
    visibility: 'gm_only',
    confidence: 0.82,
    extractorVersion: 'fixture-canon-v2',
    sources: [{ messageId: first.id, excerpt: 'called Ilyra' }],
  }).proposal
  store.decideCanonProposal(owner.campaign.id, owner.player.id, proposal.id, {
    action: 'edit_accept',
    title: 'Ilyra, lighthouse keeper',
    claim: 'Ilyra keeps the lighthouse.',
    visibility: 'campaign',
    reason: 'Tighter wording.',
  })

  const exported = store.exportAiFeedback(owner.campaign.id)
  assert.equal(exported.canon.length, 1)
  assert.equal(exported.canon[0].generatorVersion, 'fixture-canon-v2')
  assert.equal(exported.canon[0].proposal.sources[0].text, 'The lighthouse keeper is called Ilyra.')
  assert.deepEqual(exported.canon[0].decision.accepted, {
    title: 'Ilyra, lighthouse keeper', claim: 'Ilyra keeps the lighthouse.', visibility: 'campaign',
  })
  assert.equal(JSON.stringify(exported).includes('Mara'), false)
  assert.deepEqual(store.exportAiFeedback('another-campaign'), { canon: [], continuity: [], deduplication: [] })
  store.close()
})
