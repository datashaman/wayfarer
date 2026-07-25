export type Id = string

export type Envelope<TType extends string, TPayload> = {
  type: TType
  id: Id
  roomId: Id
  sentAt: string
  payload: TPayload
}

export type Participant = {
  playerId: Id
  playerName?: string
  name: string
  characterId?: Id | null
  characterName?: string | null
  muted: boolean
}

export type CampaignRoom = {
  id: Id
  slug: string
  name: string
  description: string
}

export type Campaign = {
  id: Id
  name: string
  inviteCode: string
  rooms: CampaignRoom[]
}

export type CampaignWorld = {
  campaignId?: Id
  title: string
  premise: string
  pitch: string
  truths: Array<{ id?: Id; text: string }>
  factions: Array<{ id?: Id; name: string; goal: string; opposition: string }>
  locations: Array<{ id?: Id; name: string; description: string; danger: string }>
  npcs: Array<{ id?: Id; name: string; role: string; want: string; leverage: string }>
  hooks: Array<{ id?: Id; title: string; situation: string }>
  openingCrisis: { title: string; situation: string; stakes: string }
  generatorVersion: string
  revision?: number
  createdAt?: string
  updatedAt?: string
  updatedByName?: string | null
}

export type PlayerSession = {
  id: Id
  campaignId: Id
  name: string
  role: 'owner' | 'member'
  knowledgeRole: 'gm' | 'player'
  token: string
}

export type CampaignMember = Omit<PlayerSession, 'token'>

export type CampaignManagement = {
  players: CampaignMember[]
}

export type TableSession = {
  campaign: Campaign
  player: PlayerSession
}

export type SeatEntry = TableSession & {
  recoveryCode: string
}

export type RoomMessage = {
  id: Id
  clientMessageId?: Id
  senderId: Id
  senderName: string
  playerName?: string
  characterName?: string | null
  text: string
  sentAt: string
  sequence: number
}

export type Character = {
  id: Id
  campaignId: Id
  playerId: Id
  playerName: string
  name: string
  concept: string
  appearance: string
  drive: string
  capability: string
  complication: string
  possession: string
  belief: string
  secret: string | null
  faction: { id: Id; name: string; connection: string } | null
  location: { id: Id; name: string; connection: string } | null
  npc: { id: Id; name: string; connection: string } | null
  character: { id: Id; name: string; connection: string } | null
  generatorVersion: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type CharacterCreationContext = {
  world: null | {
    title: string
    premise: string
    pitch: string
    truths: Array<{ id: Id; text: string }>
    factions: Array<{ id: Id; name: string; goal: string }>
    locations: Array<{ id: Id; name: string; description: string }>
    npcs: Array<{ id: Id; name: string; role: string }>
  }
  characters: Character[]
}

export type MessagePage = {
  messages: RoomMessage[]
  hasMore: boolean
}

export type TranscriptSearchResult = RoomMessage & {
  roomId: Id
  roomName: string
}

export type CampaignNote = {
  body: string
  revision: number
  updatedAt: string | null
  updatedByName: string | null
}

export type CampaignSession = {
  id: string
  title: string
  status: 'open' | 'closed'
  startSequence: number
  endSequence: number
  messageCount: number
  participants: Array<{ id: string; name: string }>
  canonCoverage: 'reviewed' | 'partial' | 'unreviewed'
  closedAt: string | null
  closedByName: string | null
}

export type CanonKind = 'fact' | 'character' | 'relationship' | 'promise' | 'event' | 'question' | 'contradiction' | 'rule'
export type CanonVisibility = 'campaign' | 'gm_only'
export type CanonAudience = CanonVisibility | 'characters'
export type CanonProposalStatus = 'proposed' | 'accepted' | 'disputed' | 'rejected'

export type CanonConstitution = {
  canonThreshold: 'explicit_only' | 'table_consensus' | 'played_as_true'
  playerDeclarations: 'require_confirmation' | 'stand_unless_challenged'
  oocPolicy: 'exclude' | 'explicit_corrections_only'
  correctionPolicy: 'latest_explicit' | 'flag_conflicts'
  defaultVisibility: CanonVisibility
  guidance: string
  revision: number
  updatedAt: string
  updatedByName: string | null
}

export type CanonProposalSource = {
  messageId: Id
  roomId: Id
  roomName: string
  senderName: string
  text: string
  excerpt: string | null
  sentAt: string
  sequence: number
}

export type CanonProposal = {
  id: Id
  campaignId: Id
  kind: CanonKind
  title: string
  claim: string
  visibility: CanonVisibility
  confidence: number | null
  status: CanonProposalStatus
  extractorVersion: string
  createdAt: string
  createdByName: string | null
  sources: CanonProposalSource[]
}

export type CanonEntry = {
  id: Id
  proposalId: Id
  campaignId: Id
  kind: CanonKind
  title: string
  claim: string
  visibility: CanonAudience
  audiencePlayerIds: Id[]
  audienceNames: string[]
  evidenceBasis: 'full' | 'gm_review' | 'witnessed' | 'gm_confirmed'
  revision: number
  status: 'active' | 'superseded' | 'retracted'
  createdAt: string
  updatedAt: string
  createdByName: string | null
  latestReason: string | null
  sources: CanonProposalSource[]
}

export type CanonEntryRevision = {
  id: Id
  entryId: Id
  revision: number
  action: 'accepted' | 'revised' | 'superseded' | 'retracted'
  title: string
  claim: string
  visibility: CanonAudience
  audiencePlayerIds: Id[]
  audienceNames: string[]
  reason: string | null
  createdAt: string
  createdByName: string
}

export type CanonLedger = {
  proposals: CanonProposal[]
  entries: CanonEntry[]
  coverage: {
    lastScannedSequence: number
    latestSequence: number
    unscannedCount: number
    lastScannedAt: string | null
  }
}

export type ContradictionFinding = {
  id: Id
  canonEntryId: Id
  canonTitle: string
  canonClaim: string
  title: string
  explanation: string
  confidence: number
  sources: CanonProposalSource[]
}

export type ContradictionReport = {
  id: Id
  campaignId: Id
  generatorVersion: string
  createdAt: string
  createdByName: string
  contextSession: AiContextSession | null
  findings: ContradictionFinding[]
}

export type AiContextSession = Pick<CampaignSession, 'id' | 'title' | 'status' | 'startSequence' | 'endSequence'>

export type ContinuityFeedbackRating = 'useful' | 'incorrect' | 'secret_leak' | 'not_useful'

export type ContinuityThread = {
  id: Id
  title: string
  summary: string
  whyItMatters: string
  confidence: number
  feedback: { rating: ContinuityFeedbackRating; createdAt: string } | null
  lifecycle: ContinuityLifecycleEvent
  lifecycleHistory: ContinuityLifecycleEvent[]
  sources: CanonProposalSource[]
}

export type ContinuityLifecycleEvent = {
  status: 'open' | 'dormant' | 'resolved'
  reason: string | null
  createdAt: string
  createdByName: string
}

export type ContinuityBrief = {
  id: Id
  campaignId: Id
  generatorVersion: string
  createdAt: string
  createdByName: string
  contextSession: AiContextSession | null
  threads: ContinuityThread[]
}

export type SessionRecap = {
  id: Id
  campaignId: Id
  generatorVersion: string
  status: 'draft' | 'published'
  revision: number
  publicSummary: string
  gmNotes: string | null
  contextSession: AiContextSession
  createdAt: string
  updatedAt: string
  updatedByName: string | null
  publishedAt: string | null
  sources: CanonProposalSource[]
}

export type SessionRecapRevision = {
  id: Id
  revision: number
  publicSummary: string
  gmNotes: string
  createdAt: string
  createdByName: string
}

export type AiReadiness = {
  eligible: boolean
  mode: 'prepare_only'
  checks: Array<{ id: string; label: string; passed: boolean; value: number | null; remaining: number; target: 'canon' | 'continuity' }>
  metrics: AiFeedbackMetrics
}

export type CanonFeedbackMetrics = {
  total: number
  accepted: number
  edited: number
  disputed: number
  rejected: number
  acceptanceRate: number | null
  editRate: number | null
  disputeRate: number | null
  rejectionRate: number | null
}

export type ContinuityFeedbackMetrics = {
  total: number
  useful: number
  incorrect: number
  secretLeak: number
  notUseful: number
  usefulRate: number | null
  incorrectRate: number | null
  secretLeakRate: number | null
  notUsefulRate: number | null
}

export type AiFeedbackMetrics = {
  canon: CanonFeedbackMetrics
  continuity: ContinuityFeedbackMetrics
  byGeneratorVersion: {
    canon: Record<string, CanonFeedbackMetrics>
    continuity: Record<string, ContinuityFeedbackMetrics>
  }
}

export type AiEvaluationDashboard = {
  readiness: AiReadiness
  versions: Array<{
    surface: 'canon' | 'continuity'
    version: string
    sampleSize: number
    successRate: number | null
    errorRate: number | null
    secretLeakRate: number | null
  }>
  surfaces: Array<{
    id: 'canon' | 'continuity' | 'contradictions' | 'recap' | 'knowledge' | 'intent' | 'house_rules' | 'factions'
    label: string
    authority: 'advisory' | 'draft' | 'proposal'
    version: string | null
    evaluationCommand: string
    liveCheck: null | { passed: number; total: number; passRate: number; createdAt: string }
    runtime: {
      total: number
      succeeded: number
      failed: number
      successRate: number | null
      averageDurationMs: number | null
      averageInputUnits: number | null
      averageOutputUnits: number | null
      lastRunAt: string | null
      latestErrorCategory: string | null
    }
  }>
  runs: Array<{
    id: Id
    suite: string
    model: string
    generatorVersion: string
    passed: number
    total: number
    notes: string | null
    createdAt: string
    passRate: number
    delta: number | null
  }>
  alerts: Array<{ severity: 'critical' | 'warning'; message: string }>
}

export type IntelligenceSettings = {
  autoPrepare: boolean
  tasks: { canon: boolean; continuity: boolean; recap: boolean }
  updatedAt: string | null
}

export type PreparationRun = {
  id: Id
  sessionId: Id
  status: 'queued' | 'running' | 'complete' | 'failed'
  tasks: Array<{
    name: keyof IntelligenceSettings['tasks']
    status: 'queued' | 'running' | 'complete' | 'failed'
    attempts: number
    result: Record<string, unknown> | null
    outcome: null
      | { total: number; awaiting: number; accepted: number; disputed: number; rejected: number }
      | { total: number; rated: number; useful: number; issues: number }
      | { status: 'draft' | 'published'; revision: number }
    error: string | null
    startedAt: string | null
    completedAt: string | null
  }>
  error: string | null
  createdAt: string
  completedAt: string | null
}

export type HouseRule = {
  id: Id
  title: string
  sourceRule: string
  interpretation: string
  ruling: string
  status: 'active' | 'retired'
  revision: number
  createdAt: string
  updatedAt: string
  sources: CanonProposalSource[]
}

export type HouseRuleRevision = Omit<HouseRule, 'id' | 'createdAt' | 'updatedAt'> & {
  id: Id
  reason: string
  playerName: string
  createdAt: string
}

export type HouseRuleProposal = {
  id: Id
  sessionId: Id
  generatorVersion: string
  status: 'proposed' | 'accepted' | 'rejected'
  original: Pick<HouseRule, 'title' | 'sourceRule' | 'interpretation' | 'ruling'>
  decision: null | {
    action: 'accept' | 'edit_accept' | 'reject'
    reason: string
    title: string | null
    sourceRule: string | null
    interpretation: string | null
    ruling: string | null
    decidedByName: string
    decidedAt: string
    editedFields: Array<'title' | 'sourceRule' | 'interpretation' | 'ruling'>
  }
  acceptedRuleId: Id | null
  createdByName: string
  createdAt: string
  sources: CanonProposalSource[]
}

export type FactionProposal = {
  id: Id
  summary: string
  assumptions: string
  baseProgress: number
  proposedProgress: number
  sessionId: Id
  status: 'proposed' | 'accepted' | 'rejected'
  generatorVersion: string
  createdByName: string
  decidedByName: string | null
  createdAt: string
  decidedAt: string | null
  sources: CanonProposalSource[]
}

export type FactionClock = {
  id: Id
  name: string
  goal: string
  progress: number
  segments: number
  revision: number
  createdAt: string
  updatedAt: string
  proposals: FactionProposal[]
}

export type CampaignIntelligenceOverview = {
  settings: IntelligenceSettings
  readiness: AiReadiness
  preparationRuns: PreparationRun[]
  houseRules: HouseRule[]
  houseRuleProposals: HouseRuleProposal[]
  factionClocks: FactionClock[]
  knowledgeMetrics: Array<{
    generatorVersion: string
    total: number
    useful: number
    incorrect: number
    incomplete: number
    secretLeak: number
    usefulRate: number | null
  }>
  spotlightParticipants: Array<{ id: Id; name: string; enabled: boolean }>
}

export type SpotlightReport = {
  id: Id
  session: Pick<CampaignSession, 'id' | 'title' | 'status' | 'startSequence' | 'endSequence'>
  basis: 'opted_in_text_messages'
  participants: Array<{ id: Id; name: string; messages: number; share: number }>
  totalMessages: number
  createdAt: string
}

export type SpotlightConsent = {
  enabled: boolean
  updatedAt: string | null
  history: Array<{ enabled: boolean; effectiveSequence: number; createdAt: string }>
  reports: Array<{ id: Id; session: { id: Id; title: string }; messages: number; share: number; totalMessages: number; createdAt: string }>
}

export type ClientVoiceSignal = Envelope<
  'voice.offer' | 'voice.answer',
  { targetPlayerId: Id; sdp: RTCSessionDescriptionInit }
>

export type ServerVoiceSignal = Envelope<
  'voice.offer' | 'voice.answer',
  { fromPlayerId: Id; sdp: RTCSessionDescriptionInit }
>

export type ClientIceCandidate = Envelope<
  'voice.ice_candidate',
  { targetPlayerId: Id; candidate: RTCIceCandidateInit }
>

export type ServerIceCandidate = Envelope<
  'voice.ice_candidate',
  { fromPlayerId: Id; candidate: RTCIceCandidateInit }
>

export type ClientEvent =
  | Envelope<'room.subscribe', Record<string, never>>
  | Envelope<'chat.send', { clientMessageId: Id; text: string }>
  | Envelope<'voice.join' | 'voice.leave', Record<string, never>>
  | Envelope<'voice.mute_changed', { muted: boolean }>
  | ClientVoiceSignal
  | ClientIceCandidate
  | Envelope<'ping', { sequence: number }>

export type ServerEvent =
  | Envelope<'session.revoked', { reason: 'removed' | 'recovered' }>
  | Envelope<'session.updated', { player: PlayerSession }>
  | Envelope<'campaign.updated', { campaign: Campaign }>
  | Envelope<'campaign.note_updated', { note: CampaignNote }>
  | Envelope<'campaign.canon_updated', CanonLedger>
  | Envelope<'campaign.preparation_updated', { run: PreparationRun }>
  | Envelope<'campaign.characters_updated', CharacterCreationContext>
  | Envelope<'room.activity', { senderId: Id }>
  | Envelope<'room.snapshot', { participants: Participant[]; voiceParticipants: Participant[]; messages: RoomMessage[]; hasMore: boolean }>
  | Envelope<'presence.snapshot', { participants: Participant[] }>
  | Envelope<'chat.message', RoomMessage>
  | Envelope<'voice.roster', { participants: Participant[] }>
  | Envelope<'voice.participant_joined', { participant: Participant }>
  | Envelope<'voice.participant_left', { playerId: Id }>
  | Envelope<'voice.mute_changed', { playerId: Id; muted: boolean }>
  | ServerVoiceSignal
  | ServerIceCandidate
  | Envelope<'pong', { sequence: number }>
  | Envelope<'error', { code: string; message: string; retryable: boolean }>

export type ConnectionState = 'offline' | 'connecting' | 'live' | 'reconnecting'
export type VoiceConnectionState = 'connecting' | 'connected' | 'recovering' | 'failed'

export type RuntimeConfig = {
  iceServers: RTCIceServer[]
}

type ClientPayloadMap = {
  'room.subscribe': Record<string, never>
  'chat.send': { clientMessageId: Id; text: string }
  'voice.join': Record<string, never>
  'voice.leave': Record<string, never>
  'voice.mute_changed': { muted: boolean }
  'voice.offer': { targetPlayerId: Id; sdp: RTCSessionDescriptionInit }
  'voice.answer': { targetPlayerId: Id; sdp: RTCSessionDescriptionInit }
  'voice.ice_candidate': { targetPlayerId: Id; candidate: RTCIceCandidateInit }
  ping: { sequence: number }
}

export function createEvent<T extends keyof ClientPayloadMap>(
  type: T,
  roomId: string,
  payload: ClientPayloadMap[T],
): ClientEvent {
  return {
    type,
    id: crypto.randomUUID(),
    roomId,
    sentAt: new Date().toISOString(),
    payload,
  } as ClientEvent
}
