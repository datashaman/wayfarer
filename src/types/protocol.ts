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
  name: string
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

export type PlayerSession = {
  id: Id
  campaignId: Id
  name: string
  role: 'owner' | 'member'
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
  text: string
  sentAt: string
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
  | Envelope<'campaign.updated', { campaign: Campaign }>
  | Envelope<'room.snapshot', { participants: Participant[]; voiceParticipants: Participant[]; messages: RoomMessage[] }>
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
