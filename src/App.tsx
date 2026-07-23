import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Hash,
  Headphones,
  Menu,
  Mic,
  MicOff,
  PanelRight,
  Radio,
  RefreshCw,
  Send,
  Settings,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { RealtimeClient } from './lib/realtime'
import {
  createEvent,
  type ConnectionState,
  type Campaign,
  type CampaignManagement,
  type CampaignRoom,
  type Participant,
  type RoomMessage,
  type RuntimeConfig,
  type ServerEvent,
  type TableSession,
  type VoiceConnectionState,
} from './types/protocol'

const avatarPalette = ['#b96b4b', '#7f9364', '#8b7fa4', '#ad8754', '#6d8794', '#a87955']

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function avatarColor(id: string) {
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0)
  return avatarPalette[hash % avatarPalette.length]
}

function serverOrigin() {
  if (import.meta.env.VITE_SERVER_URL) return String(import.meta.env.VITE_SERVER_URL)
  return location.port === '5173' ? `${location.protocol}//${location.hostname}:8787` : location.origin
}

function websocketUrl(token: string) {
  if (import.meta.env.VITE_WS_URL) {
    const custom = new URL(String(import.meta.env.VITE_WS_URL))
    custom.searchParams.set('token', token)
    return custom.toString()
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.port === '5173' ? `${location.hostname}:8787` : location.host
  return `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${serverOrigin()}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'Unable to reach the table.')
  return body as T
}

function Avatar({ participant, size = 'regular' }: { participant: Participant; size?: 'small' | 'regular' }) {
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ '--avatar-color': avatarColor(participant.playerId) } as React.CSSProperties}
      aria-hidden="true"
    >
      {initials(participant.name)}
    </span>
  )
}

function EntryGate({ inviteCode, notice, onEnter }: { inviteCode: string | null; notice?: string; onEnter: (session: TableSession) => void }) {
  const [playerName, setPlayerName] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!playerName.trim() || (!inviteCode && !campaignName.trim())) return
    setError('')
    setSubmitting(true)
    try {
      const path = inviteCode ? `/api/invitations/${inviteCode}/join` : '/api/campaigns'
      const session = await api<TableSession>(path, {
        method: 'POST',
        body: JSON.stringify(inviteCode ? { playerName } : { campaignName, playerName }),
      })
      onEnter(session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to enter the table.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="entry-gate">
      <div className="entry-card">
        <div className="campaign-sigil entry-sigil"><BookOpen size={21} /></div>
        <span className="campaign-kicker">Wayfarer's Table</span>
        <h1>{inviteCode ? 'Join the campaign' : 'Open a new campaign'}</h1>
        <p>{inviteCode ? 'Choose the name the party will see at the table.' : 'Name the campaign and take the first seat.'}</p>
        {notice && <div className="entry-notice" role="status">{notice}</div>}
        <form onSubmit={submit}>
          {!inviteCode && (
            <>
              <label htmlFor="campaign-name">Campaign name</label>
              <input id="campaign-name" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} maxLength={80} autoComplete="off" autoFocus />
            </>
          )}
          <label htmlFor="display-name">Your name</label>
          <input
            id="display-name"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            maxLength={40}
            autoComplete="nickname"
            autoFocus={Boolean(inviteCode)}
          />
          {error && <div className="entry-error" role="alert">{error}</div>}
          <button className="primary-action" type="submit" disabled={submitting || !playerName.trim() || (!inviteCode && !campaignName.trim())}>
            {submitting ? 'Opening…' : inviteCode ? 'Join the table' : 'Open the table'}
          </button>
        </form>
      </div>
    </main>
  )
}

function PlayerRow({ participant }: { participant: Participant }) {
  return (
    <div className="player-row">
      <Avatar participant={participant} size="small" />
      <div className="player-copy">
        <span className="player-name">{participant.name}</span>
      </div>
    </div>
  )
}

function CampaignLedger({
  rooms,
  activeRoom,
  participants,
  currentPlayer,
  onRoomChange,
  mobile,
  onClose,
}: {
  rooms: CampaignRoom[]
  activeRoom: string
  participants: Participant[]
  currentPlayer: Participant
  onRoomChange: (id: string) => void
  mobile?: boolean
  onClose?: () => void
}) {
  return (
    <aside className={`ledger ${mobile ? 'ledger--mobile' : ''}`} aria-label="Campaign navigation">
      {mobile && (
        <div className="drawer-heading">
          <span>Campaign ledger</span>
          <button className="icon-button" onClick={onClose} aria-label="Close campaign navigation"><X size={18} /></button>
        </div>
      )}

      <nav className="ledger-section" aria-labelledby="rooms-heading">
        <div className="section-label" id="rooms-heading"><span>Rooms</span></div>
        <div className="room-list">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`room-link ${activeRoom === room.id ? 'room-link--active' : ''}`}
              onClick={() => { onRoomChange(room.id); onClose?.() }}
              aria-current={activeRoom === room.id ? 'page' : undefined}
            >
              <Hash size={15} /><span>{room.name}</span>
            </button>
          ))}
        </div>
      </nav>

      <section className="ledger-section party-list" aria-labelledby="party-heading">
        <div className="section-label" id="party-heading"><span>Party · {participants.length}</span></div>
        {participants.map((participant) => <PlayerRow key={participant.playerId} participant={participant} />)}
      </section>

      <div className="ledger-footer">
        <div className="profile-button">
          <Avatar participant={currentPlayer} size="small" />
          <span><strong>{currentPlayer.name}</strong><small>You</small></span>
        </div>
      </div>
    </aside>
  )
}

function MessageItem({ message }: { message: RoomMessage }) {
  const participant: Participant = { playerId: message.senderId, name: message.senderName, muted: false }
  const time = new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <article className="message">
      <Avatar participant={participant} />
      <div className="message-body">
        <div className="message-meta"><strong>{message.senderName}</strong><time>{time}</time></div>
        <p>{message.text}</p>
      </div>
    </article>
  )
}

function VoiceTable({
  joined,
  joining,
  muted,
  pushToTalk,
  participants,
  peerConnectionStates,
  currentPlayerId,
  configReady,
  error,
  onJoin,
  onRetry,
  onToggleMute,
  onTogglePushToTalk,
  onLeave,
}: {
  joined: boolean
  joining: boolean
  muted: boolean
  pushToTalk: boolean
  participants: Participant[]
  peerConnectionStates: Record<string, VoiceConnectionState>
  currentPlayerId: string
  configReady: boolean
  error: string
  onJoin: () => void
  onRetry: () => void
  onToggleMute: () => void
  onTogglePushToTalk: () => void
  onLeave: () => void
}) {
  const hasFailedPeer = Object.values(peerConnectionStates).includes('failed')
  const seatStatus = (participant: Participant) => {
    if (participant.playerId === currentPlayerId) return muted ? 'Muted' : 'Microphone on'
    if (!joined) return 'In voice'
    const state = peerConnectionStates[participant.playerId] ?? 'connecting'
    return state === 'connected'
      ? participant.muted ? 'Muted · connected' : 'Connected'
      : state === 'recovering' ? 'Reconnecting…'
        : state === 'failed' ? 'Connection failed' : 'Connecting…'
  }

  return (
    <aside className="table-presence" aria-label="Voice table">
      <div className="table-presence-heading">
        <div><span className="eyebrow">Voice table</span><h2>{participants.length} seated</h2></div>
        {joined && <span className={`voice-live ${hasFailedPeer ? 'voice-live--issue' : 'voice-live--on'}`}><Radio size={13} /> {hasFailedPeer ? 'Voice issue' : 'In voice'}</span>}
      </div>

      {error && <div className="voice-table-error" role="alert">{error}</div>}

      <div className="seat-list">
        {participants.map((participant) => (
          <div className={`seat ${participant.playerId === currentPlayerId ? 'seat--you' : ''} ${peerConnectionStates[participant.playerId] === 'failed' ? 'seat--failed' : ''}`} key={participant.playerId}>
            <Avatar participant={participant} />
            <div className="seat-copy">
              <strong>{participant.name}{participant.playerId === currentPlayerId ? ' · you' : ''}</strong>
              <span>{seatStatus(participant)}</span>
            </div>
            {(participant.playerId === currentPlayerId ? muted : participant.muted) ? <MicOff size={15} /> : <Mic size={15} />}
          </div>
        ))}

        {!participants.length && (
          <div className="voice-empty"><Headphones size={22} /><strong>No one here yet</strong><p>Take a seat when you're ready.</p></div>
        )}
      </div>

      {!joined ? (
        <button className="primary-action primary-action--wide" onClick={onJoin} disabled={joining || !configReady}>
          <Headphones size={17} /> {joining ? 'Joining…' : configReady ? 'Join voice' : 'Preparing voice…'}
        </button>
      ) : (
        <div className="voice-panel-controls">
          {hasFailedPeer && <button className="retry-voice" onClick={onRetry}><RefreshCw size={15} /> Retry voice</button>}
          <button className={`voice-control ${muted ? 'voice-control--danger' : ''}`} onClick={onToggleMute}>
            {muted ? <MicOff size={17} /> : <Mic size={17} />}{muted ? 'Unmute' : 'Mute'}
          </button>
          <button className={`voice-control ${pushToTalk ? 'voice-control--active' : ''}`} onClick={onTogglePushToTalk}>
            <Radio size={17} /> Push to talk
          </button>
          <button className="leave-button" onClick={onLeave}>Leave voice</button>
        </div>
      )}
    </aside>
  )
}

function CampaignFolio({
  session,
  onClose,
  onCampaign,
  onCopyInvite,
}: {
  session: TableSession
  onClose: () => void
  onCampaign: (campaign: Campaign) => void
  onCopyInvite: () => void
}) {
  const [management, setManagement] = useState<CampaignManagement | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomDescription, setNewRoomDescription] = useState('')
  const [editingRoom, setEditingRoom] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [confirming, setConfirming] = useState('')
  const token = session.player.token
  const authorization = { authorization: `Bearer ${token}` }

  useEffect(() => {
    void api<CampaignManagement>('/api/campaign/manage', { headers: { authorization: `Bearer ${token}` } })
      .then(setManagement)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to open the campaign folio.'))
  }, [token])

  const run = async (key: string, action: () => Promise<void>) => {
    setError('')
    setPending(key)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The campaign could not be updated.')
    } finally {
      setPending('')
    }
  }

  const createRoom = (event: FormEvent) => {
    event.preventDefault()
    if (!newRoomName.trim()) return
    void run('create-room', async () => {
      const result = await api<{ campaign: Campaign }>('/api/campaign/rooms', {
        method: 'POST', headers: authorization, body: JSON.stringify({ name: newRoomName, description: newRoomDescription }),
      })
      onCampaign(result.campaign)
      setNewRoomName('')
      setNewRoomDescription('')
      setAddingRoom(false)
    })
  }

  const beginEdit = (room: CampaignRoom) => {
    setEditingRoom(room.id)
    setEditName(room.name)
    setEditDescription(room.description)
    setConfirming('')
  }

  const saveRoom = (event: FormEvent, roomId: string) => {
    event.preventDefault()
    if (!editName.trim()) return
    void run(`edit-${roomId}`, async () => {
      const result = await api<{ campaign: Campaign }>(`/api/campaign/rooms/${roomId}`, {
        method: 'PATCH', headers: authorization, body: JSON.stringify({ name: editName, description: editDescription }),
      })
      onCampaign(result.campaign)
      setEditingRoom(null)
    })
  }

  const moveRoom = (index: number, offset: number) => {
    const roomIds = session.campaign.rooms.map((room) => room.id)
    const destination = index + offset
    if (destination < 0 || destination >= roomIds.length) return
    ;[roomIds[index], roomIds[destination]] = [roomIds[destination], roomIds[index]]
    void run('reorder', async () => {
      const result = await api<{ campaign: Campaign }>('/api/campaign/rooms/reorder', {
        method: 'POST', headers: authorization, body: JSON.stringify({ roomIds }),
      })
      onCampaign(result.campaign)
    })
  }

  const archiveRoom = (room: CampaignRoom) => {
    const key = `archive-${room.id}`
    if (confirming !== key) { setConfirming(key); return }
    void run(key, async () => {
      const result = await api<{ campaign: Campaign }>(`/api/campaign/rooms/${room.id}`, { method: 'DELETE', headers: authorization })
      onCampaign(result.campaign)
      setConfirming('')
    })
  }

  const rotateInvitation = () => {
    if (confirming !== 'invitation') { setConfirming('invitation'); return }
    void run('invitation', async () => {
      const result = await api<{ campaign: Campaign }>('/api/campaign/invitation', { method: 'POST', headers: authorization })
      onCampaign(result.campaign)
      setConfirming('')
    })
  }

  const removePlayer = (playerId: string) => {
    const key = `remove-${playerId}`
    if (confirming !== key) { setConfirming(key); return }
    void run(key, async () => {
      const result = await api<CampaignManagement>(`/api/campaign/players/${playerId}`, { method: 'DELETE', headers: authorization })
      setManagement(result)
      setConfirming('')
    })
  }

  return (
    <div className="campaign-folio-layer" role="dialog" aria-modal="true" aria-label="Campaign folio">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close campaign folio" />
      <aside className="campaign-folio">
        <div className="drawer-heading"><span>Campaign folio</span><button className="icon-button" onClick={onClose} aria-label="Close campaign folio"><X size={18} /></button></div>
        <div className="folio-scroll">
          {error && <div className="folio-error" role="alert">{error}</div>}

          <section className="folio-section" aria-labelledby="invitation-heading">
            <div className="folio-section-heading"><div><span className="eyebrow">Invitation</span><h2 id="invitation-heading">Bring players to the table</h2></div></div>
            <p>Replacing the invitation immediately closes the previous link.</p>
            <div className="folio-actions">
              <button className="folio-button" onClick={onCopyInvite}><Copy size={15} /> Copy invitation</button>
              <button className={`folio-button ${confirming === 'invitation' ? 'folio-button--danger' : ''}`} onClick={rotateInvitation} disabled={pending === 'invitation'}><RefreshCw size={15} />{pending === 'invitation' ? 'Replacing…' : confirming === 'invitation' ? 'Confirm replacement' : 'Replace invitation'}</button>
            </div>
          </section>

          <section className="folio-section" aria-labelledby="folio-rooms-heading">
            <div className="folio-section-heading"><div><span className="eyebrow">Campaign ledger</span><h2 id="folio-rooms-heading">Rooms</h2></div><button className="folio-small-action" onClick={() => { setAddingRoom((current) => !current); setEditingRoom(null); setConfirming('') }}>{addingRoom ? 'Cancel' : 'Add room'}</button></div>
            {addingRoom && <form className="folio-form" onSubmit={createRoom}><label htmlFor="new-room-name">Room name</label><input id="new-room-name" value={newRoomName} onChange={(event) => setNewRoomName(event.target.value)} maxLength={40} autoFocus /><label htmlFor="new-room-description">Purpose</label><input id="new-room-description" value={newRoomDescription} onChange={(event) => setNewRoomDescription(event.target.value)} maxLength={120} /><button className="primary-action" type="submit" disabled={!newRoomName.trim() || pending === 'create-room'}>{pending === 'create-room' ? 'Adding…' : 'Add to ledger'}</button></form>}
            <div className="folio-room-list">
              {session.campaign.rooms.map((room, index) => editingRoom === room.id ? (
                <form className="folio-form folio-room-edit" onSubmit={(event) => saveRoom(event, room.id)} key={room.id}><label htmlFor={`room-name-${room.id}`}>Room name</label><input id={`room-name-${room.id}`} value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={40} autoFocus /><label htmlFor={`room-description-${room.id}`}>Purpose</label><input id={`room-description-${room.id}`} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={120} /><div className="folio-actions"><button className="primary-action" type="submit" disabled={!editName.trim() || pending === `edit-${room.id}`}>Save room</button><button className="folio-button" type="button" onClick={() => setEditingRoom(null)}>Cancel</button></div></form>
              ) : (
                <div className="folio-room" key={room.id}><div className="folio-room-copy"><strong><Hash size={13} />{room.name}</strong><span>{room.description || 'No purpose recorded'}</span></div><div className="folio-row-actions"><button onClick={() => moveRoom(index, -1)} disabled={index === 0 || pending === 'reorder'} aria-label={`Move ${room.name} up`}><ChevronUp size={15} /></button><button onClick={() => moveRoom(index, 1)} disabled={index === session.campaign.rooms.length - 1 || pending === 'reorder'} aria-label={`Move ${room.name} down`}><ChevronDown size={15} /></button><button onClick={() => beginEdit(room)} aria-label={`Edit ${room.name}`}><Settings size={15} /></button><button className={confirming === `archive-${room.id}` ? 'danger-action' : ''} onClick={() => archiveRoom(room)} disabled={session.campaign.rooms.length === 1 || pending === `archive-${room.id}`} aria-label={confirming === `archive-${room.id}` ? `Confirm archive ${room.name}` : `Archive ${room.name}`}><Archive size={15} /></button></div></div>
              ))}
            </div>
          </section>

          <section className="folio-section" aria-labelledby="folio-party-heading">
            <div className="folio-section-heading"><div><span className="eyebrow">Seats</span><h2 id="folio-party-heading">Party</h2></div></div>
            {!management ? <span className="folio-loading">Reading the ledger…</span> : <div className="folio-player-list">{management.players.map((player) => <div className="folio-player" key={player.id}><Avatar participant={{ playerId: player.id, name: player.name, muted: false }} size="small" /><span><strong>{player.name}</strong><small>{player.role === 'owner' ? 'Campaign owner' : 'Player'}</small></span>{player.role !== 'owner' && <button className={confirming === `remove-${player.id}` ? 'danger-action' : ''} onClick={() => removePlayer(player.id)} disabled={pending === `remove-${player.id}`} aria-label={confirming === `remove-${player.id}` ? `Confirm remove ${player.name}` : `Remove ${player.name}`}><UserMinus size={15} /></button>}</div>)}</div>}
          </section>
        </div>
      </aside>
    </div>
  )
}

function App() {
  const inviteCode = new URLSearchParams(location.search).get('campaign')
  const [session, setSession] = useState<TableSession | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [restoringSession, setRestoringSession] = useState(() => Boolean(localStorage.getItem('wayfarer-token')))
  const [activeRoom, setActiveRoom] = useState('')
  const activeRoomRef = useRef(activeRoom)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [voiceParticipants, setVoiceParticipants] = useState<Participant[]>([])
  const [peerConnectionStates, setPeerConnectionStates] = useState<Record<string, VoiceConnectionState>>({})
  const [voiceConfigReady, setVoiceConfigReady] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>('offline')
  const [draft, setDraft] = useState(() => localStorage.getItem('wayfarer-draft') ?? '')
  const [joinedVoice, setJoinedVoice] = useState(false)
  const [joiningVoice, setJoiningVoice] = useState(false)
  const [muted, setMuted] = useState(false)
  const [pushToTalk, setPushToTalk] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [mobileLedger, setMobileLedger] = useState(false)
  const [mobileTable, setMobileTable] = useState(false)
  const [campaignFolio, setCampaignFolio] = useState(false)
  const [inviteCopyState, setInviteCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const clientRef = useRef<RealtimeClient | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const audioRef = useRef(new Map<string, HTMLAudioElement>())
  const candidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const iceServersRef = useRef<RTCIceServer[]>([])
  const recoveryAttemptsRef = useRef(new Map<string, number>())
  const recoveryTimersRef = useRef(new Map<string, number>())
  const timelineRef = useRef<HTMLDivElement>(null)
  const realtimePlayer = session?.player
  const rooms = session?.campaign.rooms ?? []
  const playerId = session?.player.id ?? ''
  const displayName = session?.player.name ?? ''
  const currentPlayer: Participant = { playerId, name: displayName, muted }
  const activeRoomData = rooms.find((room) => room.id === activeRoom) ?? rooms[0]

  useEffect(() => {
    if (!realtimePlayer) return
    void api<RuntimeConfig>('/api/config', { headers: { authorization: `Bearer ${realtimePlayer.token}` } })
      .then((config) => {
        iceServersRef.current = config.iceServers
        setVoiceConfigReady(true)
      })
      .catch(() => setVoiceError('Voice configuration could not be loaded. Reload the table to try again.'))
  }, [realtimePlayer])

  useEffect(() => {
    const token = localStorage.getItem('wayfarer-token')
    if (!token) return
    void api<TableSession>('/api/session', { headers: { authorization: `Bearer ${token}` } })
      .then((restored) => {
        if (inviteCode && restored.campaign.inviteCode !== inviteCode) return
        const roomId = restored.campaign.rooms[0]?.id ?? ''
        activeRoomRef.current = roomId
        setActiveRoom(roomId)
        setSession(restored)
      })
      .catch(() => localStorage.removeItem('wayfarer-token'))
      .finally(() => setRestoringSession(false))
  }, [inviteCode])

  useEffect(() => { localStorage.setItem('wayfarer-draft', draft) }, [draft])
  useEffect(() => { timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!realtimePlayer || !activeRoomRef.current) return
    const client = new RealtimeClient(websocketUrl(realtimePlayer.token))
    clientRef.current = client
    const peerMap = peersRef.current

    const setPeerState = (peerId: string, state: VoiceConnectionState) => {
      setPeerConnectionStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state })
    }

    const clearRecovery = (peerId: string) => {
      const timer = recoveryTimersRef.current.get(peerId)
      if (timer !== undefined) window.clearTimeout(timer)
      recoveryTimersRef.current.delete(peerId)
      recoveryAttemptsRef.current.delete(peerId)
    }

    const closePeer = (peerId: string) => {
      const peer = peerMap.get(peerId)
      peerMap.delete(peerId)
      peer?.close()
      clearRecovery(peerId)
      const audio = audioRef.current.get(peerId)
      if (audio) { audio.pause(); audio.srcObject = null; audio.remove() }
      audioRef.current.delete(peerId)
      candidatesRef.current.delete(peerId)
      setPeerConnectionStates((current) => {
        if (!(peerId in current)) return current
        const next = { ...current }
        delete next[peerId]
        return next
      })
    }

    const scheduleRecovery = (peerId: string, peer: RTCPeerConnection, delay: number) => {
      if (peerMap.get(peerId) !== peer || peer.connectionState === 'closed') return
      setPeerState(peerId, 'recovering')

      const existingTimer = recoveryTimersRef.current.get(peerId)
      if (existingTimer !== undefined) window.clearTimeout(existingTimer)

      const isRecoveryLeader = realtimePlayer.id.localeCompare(peerId) < 0
      const recoveryDelay = isRecoveryLeader ? delay : Math.max(delay, 12_000)
      const timer = window.setTimeout(async () => {
        recoveryTimersRef.current.delete(peerId)
        if (peerMap.get(peerId) !== peer || peer.connectionState === 'connected' || peer.connectionState === 'closed') return

        if (!isRecoveryLeader) {
          setPeerState(peerId, 'failed')
          return
        }

        const attempt = (recoveryAttemptsRef.current.get(peerId) ?? 0) + 1
        recoveryAttemptsRef.current.set(peerId, attempt)
        if (attempt > 2) {
          setPeerState(peerId, 'failed')
          return
        }

        try {
          peer.restartIce()
          const offer = await peer.createOffer({ iceRestart: true })
          await peer.setLocalDescription(offer)
          client.send(createEvent('voice.offer', activeRoomRef.current, { targetPlayerId: peerId, sdp: offer }))
          scheduleRecovery(peerId, peer, attempt === 1 ? 5_000 : 8_000)
        } catch {
          scheduleRecovery(peerId, peer, 1_000)
        }
      }, recoveryDelay)
      recoveryTimersRef.current.set(peerId, timer)
    }

    const createPeer = (peerId: string) => {
      const existing = peerMap.get(peerId)
      if (existing) return existing
      const peer = new RTCPeerConnection({ iceServers: iceServersRef.current })
      setPeerState(peerId, 'connecting')
      streamRef.current?.getTracks().forEach((track) => peer.addTrack(track, streamRef.current!))
      peer.onicecandidate = ({ candidate }) => {
        if (candidate) client.send(createEvent('voice.ice_candidate', activeRoomRef.current, { targetPlayerId: peerId, candidate: candidate.toJSON() }))
      }
      peer.ontrack = ({ streams }) => {
        let audio = audioRef.current.get(peerId)
        if (!audio) {
          audio = new Audio()
          audio.autoplay = true
          audioRef.current.set(peerId, audio)
          document.body.append(audio)
        }
        audio.srcObject = streams[0]
        void audio.play().catch(() => undefined)
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          clearRecovery(peerId)
          setPeerState(peerId, 'connected')
          setVoiceError('')
        } else if (peer.connectionState === 'disconnected') {
          scheduleRecovery(peerId, peer, 1_500)
        } else if (peer.connectionState === 'failed') {
          scheduleRecovery(peerId, peer, 0)
        } else if (['new', 'connecting'].includes(peer.connectionState)) {
          setPeerConnectionStates((current) => current[peerId] === 'recovering' ? current : { ...current, [peerId]: 'connecting' })
        }
      }
      peerMap.set(peerId, peer)
      return peer
    }

    const flushCandidates = async (peerId: string, peer: RTCPeerConnection) => {
      const queued = candidatesRef.current.get(peerId) ?? []
      candidatesRef.current.delete(peerId)
      for (const candidate of queued) await peer.addIceCandidate(candidate)
    }

    const handleEvent = async (event: ServerEvent) => {
      if (event.type === 'session.revoked') {
        localStorage.removeItem('wayfarer-token')
        client.close()
        setEntryNotice('Your seat was removed from this campaign.')
        setSession(null)
        setActiveRoom('')
        activeRoomRef.current = ''
        return
      }
      if (event.type === 'campaign.updated') {
        const campaign = event.payload.campaign
        setSession((current) => current ? { ...current, campaign } : current)
        const url = new URL(location.href)
        url.searchParams.set('campaign', campaign.inviteCode)
        history.replaceState({}, '', url)
        if (!campaign.rooms.some((room) => room.id === activeRoomRef.current)) {
          const roomId = campaign.rooms[0]?.id ?? ''
          activeRoomRef.current = roomId
          setActiveRoom(roomId)
          setMessages([])
          setParticipants([])
          setVoiceParticipants([])
          setPeerConnectionStates({})
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          setJoinedVoice(false)
          if (roomId) client.send(createEvent('room.subscribe', roomId, {}))
        }
        return
      }
      if (event.roomId !== activeRoomRef.current) return
      if (event.type === 'room.snapshot') {
        setMessages(event.payload.messages)
        setParticipants(event.payload.participants)
        setVoiceParticipants(event.payload.voiceParticipants)
      } else if (event.type === 'presence.snapshot') {
        setParticipants(event.payload.participants)
      } else if (event.type === 'chat.message') {
        setMessages((current) => current.some((message) => message.id === event.payload.id) ? current : [...current, event.payload])
      } else if (event.type === 'voice.roster') {
        setVoiceParticipants([...event.payload.participants, { playerId: realtimePlayer.id, name: realtimePlayer.name, muted: false }])
        for (const participant of event.payload.participants) {
          const peer = createPeer(participant.playerId)
          const offer = await peer.createOffer()
          await peer.setLocalDescription(offer)
          client.send(createEvent('voice.offer', activeRoomRef.current, { targetPlayerId: participant.playerId, sdp: offer }))
        }
      } else if (event.type === 'voice.participant_joined') {
        setVoiceParticipants((current) => current.some((item) => item.playerId === event.payload.participant.playerId) ? current : [...current, event.payload.participant])
      } else if (event.type === 'voice.participant_left') {
        closePeer(event.payload.playerId)
        setVoiceParticipants((current) => current.filter((item) => item.playerId !== event.payload.playerId))
      } else if (event.type === 'voice.mute_changed') {
        setVoiceParticipants((current) => current.map((item) => item.playerId === event.payload.playerId ? { ...item, muted: event.payload.muted } : item))
      } else if (event.type === 'voice.offer') {
        const peer = createPeer(event.payload.fromPlayerId)
        await peer.setRemoteDescription(event.payload.sdp)
        await flushCandidates(event.payload.fromPlayerId, peer)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        client.send(createEvent('voice.answer', activeRoomRef.current, { targetPlayerId: event.payload.fromPlayerId, sdp: answer }))
      } else if (event.type === 'voice.answer') {
        const peer = createPeer(event.payload.fromPlayerId)
        await peer.setRemoteDescription(event.payload.sdp)
        await flushCandidates(event.payload.fromPlayerId, peer)
      } else if (event.type === 'voice.ice_candidate') {
        const peer = peerMap.get(event.payload.fromPlayerId)
        if (peer?.remoteDescription) await peer.addIceCandidate(event.payload.candidate)
        else candidatesRef.current.set(event.payload.fromPlayerId, [...(candidatesRef.current.get(event.payload.fromPlayerId) ?? []), event.payload.candidate])
      }
    }

    const unsubscribeEvent = client.onEvent((event) => {
      void handleEvent(event).catch(() => setVoiceError('A voice connection could not be negotiated. Retry voice to reconnect.'))
    })
    const unsubscribeState = client.onState((state) => {
      setConnection(state)
      if (state === 'live') {
        client.send(createEvent('room.subscribe', activeRoomRef.current, {}))
        if (streamRef.current) client.send(createEvent('voice.join', activeRoomRef.current, {}))
      }
      if (state === 'reconnecting') peerMap.forEach((_, peerId) => closePeer(peerId))
    })
    client.connect()

    return () => {
      unsubscribeEvent()
      unsubscribeState()
      client.close()
      peerMap.forEach((_, peerId) => closePeer(peerId))
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [realtimePlayer])

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted })
    if (joinedVoice) clientRef.current?.send(createEvent('voice.mute_changed', activeRoomRef.current, { muted }))
  }, [joinedVoice, muted])

  useEffect(() => {
    if (!joinedVoice || !pushToTalk) return
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); setMuted(false) }
    }
    const up = (event: globalThis.KeyboardEvent) => { if (event.code === 'Space') setMuted(true) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [joinedVoice, pushToTalk])

  const enterTable = (entered: TableSession) => {
    localStorage.setItem('wayfarer-token', entered.player.token)
    const roomId = entered.campaign.rooms[0]?.id ?? ''
    activeRoomRef.current = roomId
    setActiveRoom(roomId)
    setSession(entered)
    setEntryNotice('')
    const url = new URL(location.href)
    url.searchParams.set('campaign', entered.campaign.inviteCode)
    history.replaceState({}, '', url)
  }

  const updateCampaign = (campaign: Campaign) => {
    setSession((current) => current ? { ...current, campaign } : current)
    const url = new URL(location.href)
    url.searchParams.set('campaign', campaign.inviteCode)
    history.replaceState({}, '', url)
  }

  const copyInvite = async () => {
    if (!session) return
    const url = new URL(location.href)
    url.searchParams.set('campaign', session.campaign.inviteCode)
    let copied: boolean
    try {
      await navigator.clipboard.writeText(url.toString())
      copied = true
    } catch {
      const field = document.createElement('textarea')
      field.value = url.toString()
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()
      copied = document.execCommand('copy')
      field.remove()
    }
    setInviteCopyState(copied ? 'copied' : 'failed')
    window.setTimeout(() => setInviteCopyState('idle'), 1_800)
  }

  const leaveVoice = () => {
    clientRef.current?.send(createEvent('voice.leave', activeRoomRef.current, {}))
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    peersRef.current.forEach((peer) => peer.close())
    peersRef.current.clear()
    recoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    recoveryTimersRef.current.clear()
    recoveryAttemptsRef.current.clear()
    audioRef.current.forEach((audio) => { audio.pause(); audio.remove() })
    audioRef.current.clear()
    setVoiceParticipants((current) => current.filter((participant) => participant.playerId !== playerId))
    setPeerConnectionStates({})
    setJoinedVoice(false)
    setMuted(false)
    setPushToTalk(false)
  }

  const retryVoice = () => {
    if (!joinedVoice || !streamRef.current || connection !== 'live') return
    setVoiceError('')
    clientRef.current?.send(createEvent('voice.leave', activeRoomRef.current, {}))
    peersRef.current.forEach((peer) => peer.close())
    peersRef.current.clear()
    recoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    recoveryTimersRef.current.clear()
    recoveryAttemptsRef.current.clear()
    candidatesRef.current.clear()
    audioRef.current.forEach((audio) => { audio.pause(); audio.srcObject = null; audio.remove() })
    audioRef.current.clear()
    setPeerConnectionStates({})
    window.setTimeout(() => {
      if (streamRef.current && clientRef.current) clientRef.current.send(createEvent('voice.join', activeRoomRef.current, {}))
    }, 200)
  }

  const changeRoom = (roomId: string) => {
    if (roomId === activeRoom) return
    if (joinedVoice) leaveVoice()
    activeRoomRef.current = roomId
    setActiveRoom(roomId)
    setMessages([])
    setParticipants([])
    setVoiceParticipants([])
    setPeerConnectionStates({})
    if (connection === 'live') clientRef.current?.send(createEvent('room.subscribe', roomId, {}))
  }

  const joinVoice = async () => {
    if (joiningVoice || connection !== 'live' || !voiceConfigReady) return
    setVoiceError('')
    setJoiningVoice(true)
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      setJoinedVoice(true)
      clientRef.current?.send(createEvent('voice.join', activeRoomRef.current, {}))
    } catch {
      setVoiceError('We could not access your microphone. Check its permissions and try again.')
    } finally {
      setJoiningVoice(false)
    }
  }

  const togglePushToTalk = () => setPushToTalk((current) => { setMuted(!current); return !current })

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || connection !== 'live') return
    const clientMessageId = crypto.randomUUID()
    clientRef.current?.send(createEvent('chat.send', activeRoom, { clientMessageId, text }))
    setDraft('')
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
  }

  if (restoringSession) return <main className="entry-gate"><span className="entry-wait">Returning to the table…</span></main>
  if (!session) return <EntryGate inviteCode={inviteCode} notice={entryNotice} onEnter={enterTable} />
  if (!activeRoomData) return null

  return (
    <div className="app-shell">
      <header className="campaign-bar">
        <div className="campaign-identity">
          <button className="icon-button mobile-only" onClick={() => setMobileLedger(true)} aria-label="Open campaign navigation"><Menu size={19} /></button>
          <div className="campaign-sigil" aria-hidden="true"><BookOpen size={18} /></div>
          <div><span className="campaign-kicker">Wayfarer's Table</span><span className="campaign-title">{session.campaign.name}</span></div>
        </div>
        <div className="campaign-actions">
          {connection !== 'live' && <span className="connection-state"><i />{connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>}
          <button className="text-button invite-button" onClick={copyInvite}>{inviteCopyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}{inviteCopyState === 'copied' ? 'Copied' : inviteCopyState === 'failed' ? 'Copy failed' : 'Invite players'}</button>
          {session.player.role === 'owner' && <button className="icon-button" onClick={() => setCampaignFolio(true)} aria-label="Open campaign folio"><Settings size={18} /></button>}
          <button className="icon-button mobile-only" onClick={() => setMobileTable(true)} aria-label="Open voice table"><Users size={19} /></button>
        </div>
      </header>

      <CampaignLedger rooms={rooms} activeRoom={activeRoom} participants={participants} currentPlayer={currentPlayer} onRoomChange={changeRoom} />

      <main className="conversation">
        <header className="room-heading"><div><div className="room-title"><Hash size={19} /><h1>{activeRoomData.name}</h1></div><p>{activeRoomData.description}</p></div></header>
        <div className="timeline" ref={timelineRef} aria-live="polite" aria-label={`${activeRoomData.name} messages`}>
          {messages.length ? messages.map((message) => <MessageItem key={message.id} message={message} />) : (
            <div className="empty-transcript"><Hash size={20} /><strong>Start the conversation</strong><span>There are no messages in #{activeRoomData.name} yet.</span></div>
          )}
        </div>
        <div className="composer-wrap">
          <form className="composer" onSubmit={sendMessage}>
            <textarea rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} maxLength={2_000} placeholder={`Message #${activeRoomData.name}`} aria-label={`Message ${activeRoomData.name}`} disabled={connection !== 'live'} />
            <div className="composer-footer"><span>Enter to send · Shift + Enter for a new line</span><button className="send-button" type="submit" disabled={!draft.trim() || connection !== 'live'} aria-label="Send message"><Send size={16} /></button></div>
          </form>
        </div>
      </main>

      <VoiceTable joined={joinedVoice} joining={joiningVoice} muted={muted} pushToTalk={pushToTalk} participants={voiceParticipants} peerConnectionStates={peerConnectionStates} currentPlayerId={playerId} configReady={voiceConfigReady} error={voiceError} onJoin={joinVoice} onRetry={retryVoice} onToggleMute={() => setMuted((current) => !current)} onTogglePushToTalk={togglePushToTalk} onLeave={leaveVoice} />

      {mobileLedger && (
        <div className="drawer-layer mobile-only" role="dialog" aria-modal="true" aria-label="Campaign navigation">
          <button className="drawer-scrim" onClick={() => setMobileLedger(false)} aria-label="Close campaign navigation" />
          <CampaignLedger rooms={rooms} activeRoom={activeRoom} participants={participants} currentPlayer={currentPlayer} onRoomChange={changeRoom} mobile onClose={() => setMobileLedger(false)} />
        </div>
      )}

      {mobileTable && (
        <div className="drawer-layer drawer-layer--right mobile-only" role="dialog" aria-modal="true" aria-label="Voice table controls">
          <button className="drawer-scrim" onClick={() => setMobileTable(false)} aria-label="Close voice table" />
          <div className="mobile-table-drawer"><div className="drawer-heading"><span>Voice table</span><button className="icon-button" onClick={() => setMobileTable(false)} aria-label="Close voice table"><X size={18} /></button></div><VoiceTable joined={joinedVoice} joining={joiningVoice} muted={muted} pushToTalk={pushToTalk} participants={voiceParticipants} peerConnectionStates={peerConnectionStates} currentPlayerId={playerId} configReady={voiceConfigReady} error={voiceError} onJoin={joinVoice} onRetry={retryVoice} onToggleMute={() => setMuted((current) => !current)} onTogglePushToTalk={togglePushToTalk} onLeave={leaveVoice} /></div>
        </div>
      )}

      {campaignFolio && <CampaignFolio session={session} onClose={() => setCampaignFolio(false)} onCampaign={updateCampaign} onCopyInvite={copyInvite} />}

      <div className="voice-dock mobile-only">
        {!joinedVoice ? <button className="primary-action" onClick={joinVoice} disabled={joiningVoice || connection !== 'live' || !voiceConfigReady}><Headphones size={17} />{joiningVoice ? 'Joining…' : voiceConfigReady ? 'Join voice' : 'Preparing voice…'}</button> : <><button className={`dock-mic ${muted ? 'dock-mic--muted' : ''}`} onClick={() => setMuted((current) => !current)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button><span>{Object.values(peerConnectionStates).includes('failed') ? 'Voice issue' : Object.values(peerConnectionStates).includes('recovering') ? 'Reconnecting voice…' : muted ? 'Muted' : `${voiceParticipants.length} in voice`}</span><button className="quiet-icon" onClick={() => setMobileTable(true)} aria-label="Voice settings"><PanelRight size={17} /></button></>}
      </div>
    </div>
  )
}

export default App
