import {
  Archive,
  BookOpen,
  BookMarked,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Hash,
  Headphones,
  KeyRound,
  Menu,
  Mic,
  MicOff,
  NotebookPen,
  PanelRight,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Send,
  Share2,
  Settings,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { RealtimeClient } from './lib/realtime'
import {
  createEvent,
  type ConnectionState,
  type Campaign,
  type CanonLedger,
  type CanonConstitution,
  type CanonEntry,
  type CanonEntryRevision,
  type CanonProposal,
  type CanonProposalSource,
  type ContinuityBrief,
  type ContinuityFeedbackRating,
  type ContradictionReport,
  type CampaignManagement,
  type CampaignNote,
  type CampaignSession,
  type CampaignRoom,
  type Participant,
  type MessagePage,
  type RoomMessage,
  type RuntimeConfig,
  type SeatEntry,
  type ServerEvent,
  type TableSession,
  type TranscriptSearchResult,
  type VoiceConnectionState,
} from './types/protocol'

const avatarPalette = ['#b96b4b', '#7f9364', '#8b7fa4', '#ad8754', '#6d8794', '#a87955']
const pendingSeatEntryKey = 'wayfarer-pending-seat-entry'
const savedSeatsKey = 'wayfarer-saved-seats'
const activeCampaignKey = 'wayfarer-active-campaign'

type RecoverySeed = { playerName: string; recoveryCode: string }
type SavedSeat = {
  campaignId: string
  campaignName: string
  inviteCode: string
  playerId: string
  playerName: string
  role: 'owner' | 'member'
  knowledgeRole: 'gm' | 'player'
  token: string
}

function readSavedSeats(): SavedSeat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedSeatsKey) ?? '[]') as Partial<SavedSeat>[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((seat): seat is SavedSeat =>
      typeof seat.campaignId === 'string'
      && typeof seat.campaignName === 'string'
      && typeof seat.inviteCode === 'string'
      && typeof seat.playerId === 'string'
      && typeof seat.playerName === 'string'
      && (seat.role === 'owner' || seat.role === 'member')
      && (seat.knowledgeRole === 'gm' || seat.knowledgeRole === 'player')
      && typeof seat.token === 'string')
  } catch {
    return []
  }
}

function saveSeat(session: TableSession) {
  const seat: SavedSeat = {
    campaignId: session.campaign.id,
    campaignName: session.campaign.name,
    inviteCode: session.campaign.inviteCode,
    playerId: session.player.id,
    playerName: session.player.name,
    role: session.player.role,
    knowledgeRole: session.player.knowledgeRole,
    token: session.player.token,
  }
  const seats = [seat, ...readSavedSeats().filter((saved) => saved.campaignId !== seat.campaignId)]
  localStorage.setItem(savedSeatsKey, JSON.stringify(seats))
  localStorage.setItem(activeCampaignKey, seat.campaignId)
  return seats
}

function forgetSeat(campaignId: string) {
  const seats = readSavedSeats().filter((seat) => seat.campaignId !== campaignId)
  localStorage.setItem(savedSeatsKey, JSON.stringify(seats))
  if (localStorage.getItem(activeCampaignKey) === campaignId) localStorage.removeItem(activeCampaignKey)
  return seats
}

function updateSavedPlayer(player: TableSession['player']) {
  const seats = readSavedSeats().map((seat) => seat.campaignId === player.campaignId
    ? { ...seat, playerName: player.name, role: player.role, knowledgeRole: player.knowledgeRole, token: player.token }
    : seat)
  localStorage.setItem(savedSeatsKey, JSON.stringify(seats))
  return seats
}

function seatToRestore(inviteCode: string | null) {
  const seats = readSavedSeats()
  if (inviteCode) return seats.find((seat) => seat.inviteCode === inviteCode) ?? null
  const activeCampaignId = localStorage.getItem(activeCampaignKey)
  return seats.find((seat) => seat.campaignId === activeCampaignId) ?? null
}

function readPendingSeatEntry(): SeatEntry | null {
  try {
    const stored = sessionStorage.getItem(pendingSeatEntryKey)
    if (!stored) return null
    const entry = JSON.parse(stored) as Partial<SeatEntry>
    return typeof entry.recoveryCode === 'string'
      && typeof entry.campaign?.inviteCode === 'string'
      && Array.isArray(entry.campaign.rooms)
      && typeof entry.player?.name === 'string'
      && typeof entry.player.token === 'string'
      ? entry as SeatEntry
      : null
  } catch {
    return null
  }
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function avatarColor(id: string) {
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0)
  return avatarPalette[hash % avatarPalette.length]
}

function serverOrigin() {
  if (import.meta.env.VITE_SERVER_URL) return String(import.meta.env.VITE_SERVER_URL)
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8787` : location.origin
}

function websocketUrl(token: string) {
  if (import.meta.env.VITE_WS_URL) {
    const custom = new URL(String(import.meta.env.VITE_WS_URL))
    custom.searchParams.set('token', token)
    return custom.toString()
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = import.meta.env.DEV ? `${location.hostname}:8787` : location.host
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

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

function encodeRecoverySeed(seed: RecoverySeed) {
  const bytes = new TextEncoder().encode(JSON.stringify(seed))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function readRecoverySeed(): RecoverySeed | null {
  const match = location.hash.match(/^#recover=([A-Za-z0-9_-]+)$/)
  if (!match) return null
  const cleanUrl = new URL(location.href)
  cleanUrl.hash = ''
  history.replaceState({}, '', cleanUrl)
  try {
    const encoded = match[1].replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RecoverySeed>
    return typeof parsed.playerName === 'string' && typeof parsed.recoveryCode === 'string'
      ? { playerName: parsed.playerName, recoveryCode: parsed.recoveryCode }
      : null
  } catch {
    return null
  }
}

function recoveryUrl(inviteCode: string, seed: RecoverySeed) {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('invite', inviteCode)
  url.hash = `recover=${encodeRecoverySeed(seed)}`
  return url.toString()
}

function campaignInviteUrl(inviteCode: string) {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('invite', inviteCode)
  url.hash = ''
  return url.toString()
}

function readInvitationCode() {
  return new URLSearchParams(location.search).get('invite')
}

function showInvitationInUrl(inviteCode: string) {
  const url = new URL(location.href)
  url.searchParams.set('invite', inviteCode)
  history.replaceState({}, '', url)
}

function SeatKeyPanel({ inviteCode, playerName, recoveryCode, onDone, compact = false }: RecoverySeed & { inviteCode: string; onDone: () => void; compact?: boolean }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const url = recoveryUrl(inviteCode, { playerName, recoveryCode })

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M', margin: 1, width: 176,
      color: { dark: '#12100d', light: '#e9dfca' },
    }).then((image) => { if (active) setQrDataUrl(image) })
    return () => { active = false }
  }, [url])

  const copyKey = async () => {
    const copied = await copyText(recoveryCode)
    setCopyState(copied ? 'copied' : 'failed')
    window.setTimeout(() => setCopyState('idle'), 1_800)
  }

  return (
    <section className={`seat-key ${compact ? 'seat-key--compact' : ''}`} aria-labelledby={`seat-key-${compact ? 'reset' : 'issued'}`}>
      <div className="seat-key-copy">
        <span className="eyebrow">Seat recovery</span>
        <h2 id={`seat-key-${compact ? 'reset' : 'issued'}`}>Save {compact ? `${playerName}'s new key` : 'your seat key'}</h2>
        <p>This key is shown once. Keep it private; it can move this seat to another browser.</p>
        <code>{recoveryCode}</code>
        <button className="folio-button" type="button" onClick={copyKey}>
          {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
          {copyState === 'copied' ? 'Key copied' : copyState === 'failed' ? 'Copy failed' : 'Copy seat key'}
        </button>
      </div>
      <div className="seat-key-qr">
        {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for recovering ${playerName}'s seat`} /> : <span>Preparing QR…</span>}
        <small>Scan on the browser where you want to recover this seat.</small>
      </div>
      <button className="primary-action seat-key-done" type="button" onClick={onDone}>{compact ? 'Done' : 'I saved my seat key'}</button>
    </section>
  )
}

function InvitationSheet({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [shareError, setShareError] = useState('')
  const url = campaignInviteUrl(campaign.inviteCode)
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M', margin: 2, width: 216,
      color: { dark: '#12100d', light: '#e9dfca' },
    }).then((image) => { if (active) setQrDataUrl(image) })
    return () => { active = false }
  }, [url])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const copyInvitation = async () => {
    const copied = await copyText(url)
    setCopyState(copied ? 'copied' : 'failed')
    window.setTimeout(() => setCopyState('idle'), 1_800)
  }

  const shareInvitation = async () => {
    setShareError('')
    try {
      await navigator.share({ title: campaign.name, text: `Join ${campaign.name} at Wayfarer's Table.`, url })
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setShareError('This browser could not open its share menu. Copy the invitation instead.')
    }
  }

  return (
    <div className="invite-sheet-layer" role="dialog" aria-modal="true" aria-labelledby="invite-sheet-heading">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close invitation" />
      <aside className="invite-sheet">
        <div className="drawer-heading"><span>Campaign invitation</span><button className="icon-button" onClick={onClose} aria-label="Close invitation"><X size={18} /></button></div>
        <div className="invite-sheet-body">
          <div className="campaign-sigil invite-sheet-sigil" aria-hidden="true"><BookOpen size={21} /></div>
          <span className="eyebrow">Wayfarer's Table</span>
          <h1 id="invite-sheet-heading">{campaign.name}</h1>
          <p>Scan to join as a new player, or send the invitation link.</p>
          <div className="invite-qr">
            {qrDataUrl ? <img src={qrDataUrl} alt={`QR code to join ${campaign.name}`} /> : <span>Preparing invitation…</span>}
          </div>
          <div className="invite-link"><span>Invitation link</span><code>{url}</code></div>
          {shareError && <div className="entry-error" role="alert">{shareError}</div>}
          <div className="invite-sheet-actions">
            <button className="primary-action" type="button" onClick={copyInvitation}>{copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}{copyState === 'copied' ? 'Invitation copied' : copyState === 'failed' ? 'Copy failed' : 'Copy invitation'}</button>
            {canShare && <button className="folio-button" type="button" onClick={shareInvitation}><Share2 size={15} /> Share…</button>}
          </div>
          <small className="invite-note">Anyone with this invitation can take a new seat. The campaign owner can replace it at any time.</small>
        </div>
      </aside>
    </div>
  )
}

function TranscriptSearch({ session, onClose, onOpenRoom }: { session: TableSession; onClose: () => void; onOpenRoom: (roomId: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TranscriptSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const authorization = { authorization: `Bearer ${session.player.token}` }

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const searchTranscript = async (event: FormEvent) => {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    setPending(true)
    setError('')
    try {
      const response = await api<{ results: TranscriptSearchResult[] }>(`/api/campaign/search?q=${encodeURIComponent(text)}`, { headers: authorization })
      setResults(response.results)
      setSearched(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The transcript could not be searched.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="transcript-search-layer" role="dialog" aria-modal="true" aria-labelledby="transcript-search-heading">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close transcript search" />
      <aside className="transcript-search">
        <div className="drawer-heading"><span id="transcript-search-heading">Search the transcript</span><button className="icon-button" onClick={onClose} aria-label="Close transcript search"><X size={18} /></button></div>
        <div className="transcript-search-body">
          <form className="transcript-search-form" onSubmit={searchTranscript}>
            <label htmlFor="transcript-query">Words spoken at the table</label>
            <div><Search size={15} /><input id="transcript-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} autoComplete="off" autoFocus /><button type="submit" disabled={pending || !query.trim()}>{pending ? 'Reading…' : 'Search'}</button></div>
          </form>
          {error && <div className="entry-error" role="alert">{error}</div>}
          <div className="transcript-results" aria-live="polite">
            {results.map((result) => <button key={result.id} className="transcript-result" onClick={() => { onOpenRoom(result.roomId); onClose() }}><span><Hash size={12} />{result.roomName}<time>{new Date(result.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span><strong>{result.senderName}</strong><p>{result.text}</p></button>)}
            {searched && !results.length && <div className="transcript-search-empty"><Search size={20} /><strong>No passage found</strong><span>Try another name, phrase, or detail from the session.</span></div>}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SharedNotes({ session, note, onNote, onClose }: { session: TableSession; note: CampaignNote | null; onNote: (note: CampaignNote) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(note?.body ?? '')
  const [baseNote, setBaseNote] = useState<CampaignNote | null>(note)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const authorization = { authorization: `Bearer ${session.player.token}` }
  const remoteChanged = Boolean(note && baseNote && note.revision !== baseNote.revision)

  useEffect(() => {
    if (baseNote) return
    void api<{ note: CampaignNote }>('/api/campaign/notes', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(({ note: loaded }) => {
        setDraft(loaded.body)
        setBaseNote(loaded)
        onNote(loaded)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The campaign notes could not be opened.'))
  }, [baseNote, onNote, session.player.token])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const saveNote = async () => {
    if (!baseNote || draft === baseNote.body) return
    setPending(true)
    setError('')
    try {
      const result = await api<{ note: CampaignNote }>('/api/campaign/notes', {
        method: 'PUT', headers: authorization, body: JSON.stringify({ body: draft, revision: baseNote.revision }),
      })
      setBaseNote(result.note)
      setDraft(result.note.body)
      onNote(result.note)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The campaign notes could not be saved.')
      void api<{ note: CampaignNote }>('/api/campaign/notes', { headers: authorization }).then(({ note: latest }) => onNote(latest))
    } finally {
      setPending(false)
    }
  }

  const loadLatest = () => {
    if (!note) return
    setDraft(note.body)
    setBaseNote(note)
    setError('')
  }

  return (
    <div className="shared-notes-layer" role="dialog" aria-modal="true" aria-labelledby="shared-notes-heading">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close shared notes" />
      <aside className="shared-notes">
        <div className="drawer-heading"><span id="shared-notes-heading">Campaign notes</span><button className="icon-button" onClick={onClose} aria-label="Close shared notes"><X size={18} /></button></div>
        <div className="shared-notes-body">
          <div className="shared-notes-heading"><span className="eyebrow">Shared ledger page</span><h2>Notes for the whole party</h2><p>Plans, names, clues, and promises kept between sessions.</p></div>
          {remoteChanged && <div className="notes-conflict" role="status"><span>The notes changed at another seat.</span><button onClick={loadLatest}>Load latest</button></div>}
          {error && <div className="entry-error" role="alert">{error}</div>}
          {!baseNote ? <span className="folio-loading">Opening the ledger…</span> : <><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={20_000} aria-label="Shared campaign notes" placeholder="Record what the party should remember…" /><div className="shared-notes-footer"><span>{baseNote.updatedAt ? `Last saved by ${baseNote.updatedByName ?? 'a player'} · ${new Date(baseNote.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No notes recorded yet'}</span><button className="primary-action" onClick={saveNote} disabled={pending || draft === baseNote.body || remoteChanged}>{pending ? 'Saving…' : 'Save notes'}</button></div></>}
        </div>
      </aside>
    </div>
  )
}

function CanonLedgerSheet({ session, ledger, onLedger, onClose, onOpenSource }: { session: TableSession; ledger: CanonLedger | null; onLedger: (ledger: CanonLedger) => void; onClose: () => void; onOpenSource: (source: CanonProposalSource) => void }) {
  const [pending, setPending] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [editing, setEditing] = useState<CanonProposal | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editClaim, setEditClaim] = useState('')
  const [editVisibility, setEditVisibility] = useState<'campaign' | 'gm_only'>('gm_only')
  const [entryMode, setEntryMode] = useState<{ entry: CanonEntry; action: 'revise' | 'supersede' | 'retract' } | null>(null)
  const [entryTitle, setEntryTitle] = useState('')
  const [entryClaim, setEntryClaim] = useState('')
  const [entryVisibility, setEntryVisibility] = useState<'campaign' | 'gm_only'>('gm_only')
  const [entryReason, setEntryReason] = useState('')
  const [entryHistory, setEntryHistory] = useState<Record<string, CanonEntryRevision[]>>({})
  const [continuityBrief, setContinuityBrief] = useState<ContinuityBrief | null>(null)
  const [continuityLoaded, setContinuityLoaded] = useState(false)
  const [continuityPending, setContinuityPending] = useState(false)
  const [contradictionReport, setContradictionReport] = useState<ContradictionReport | null>(null)
  const [contradictionsLoaded, setContradictionsLoaded] = useState(false)
  const [contradictionsPending, setContradictionsPending] = useState(false)
  const [constitution, setConstitution] = useState<CanonConstitution | null>(null)
  const [constitutionDraft, setConstitutionDraft] = useState<CanonConstitution | null>(null)
  const [editingConstitution, setEditingConstitution] = useState(false)
  const [campaignSessions, setCampaignSessions] = useState<CampaignSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('')
  const [error, setError] = useState('')
  const authorization = { authorization: `Bearer ${session.player.token}` }
  const isGm = session.player.knowledgeRole === 'gm'

  useEffect(() => {
    if (!isGm) return
    void api<{ constitution: CanonConstitution }>('/api/campaign/canon/constitution', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(({ constitution: loaded }) => setConstitution(loaded))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The canon constitution could not be opened.'))
  }, [isGm, session.player.token])

  useEffect(() => {
    if (!isGm) return
    void api<{ sessions: CampaignSession[] }>('/api/campaign/sessions', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(({ sessions }) => {
        setCampaignSessions(sessions)
        setSelectedSessionId((current) => sessions.some((item) => item.id === current) ? current : sessions[0]?.id ?? '')
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Campaign sessions could not be opened.'))
  }, [isGm, session.player.token])

  useEffect(() => {
    void api<CanonLedger>('/api/campaign/canon', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(onLedger)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The canon ledger could not be opened.'))
  }, [onLedger, session.player.token])

  useEffect(() => {
    if (!isGm || continuityLoaded) return
    void api<{ brief: ContinuityBrief | null }>('/api/campaign/continuity', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(({ brief }) => setContinuityBrief(brief))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The continuity brief could not be opened.'))
      .finally(() => setContinuityLoaded(true))
  }, [continuityLoaded, isGm, session.player.token])

  useEffect(() => {
    if (!isGm || contradictionsLoaded) return
    void api<{ report: ContradictionReport | null }>('/api/campaign/contradictions', { headers: { authorization: `Bearer ${session.player.token}` } })
      .then(({ report }) => setContradictionReport(report))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The contradiction report could not be opened.'))
      .finally(() => setContradictionsLoaded(true))
  }, [contradictionsLoaded, isGm, session.player.token])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const decide = async (proposal: CanonProposal, action: 'accept' | 'edit_accept' | 'dispute' | 'reject', reason?: 'incorrect' | 'secret_leak' | 'not_useful', visibility?: 'campaign' | 'gm_only') => {
    setPending(proposal.id)
    setError('')
    try {
      const result = await api<CanonLedger & { proposal: CanonProposal }>(`/api/campaign/canon/proposals/${proposal.id}/decisions`, {
        method: 'POST',
        headers: authorization,
        body: JSON.stringify({ action, reason, visibility, ...(action === 'edit_accept' ? { title: editTitle, claim: editClaim } : {}) }),
      })
      onLedger({
        proposals: result.proposals,
        entries: result.entries,
        coverage: result.coverage,
      })
      setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The canon decision could not be recorded.')
    } finally {
      setPending('')
    }
  }

  const beginEditing = (proposal: CanonProposal) => {
    setEditing(proposal)
    setEditTitle(proposal.title)
    setEditClaim(proposal.claim)
    setEditVisibility(constitution?.defaultVisibility ?? 'gm_only')
  }

  const beginConstitutionEdit = () => {
    if (!constitution) return
    setConstitutionDraft({ ...constitution })
    setEditingConstitution(true)
  }

  const saveConstitution = async () => {
    if (!constitutionDraft) return
    setPending('constitution')
    setError('')
    try {
      const result = await api<{ constitution: CanonConstitution }>('/api/campaign/canon/constitution', {
        method: 'PUT', headers: authorization, body: JSON.stringify(constitutionDraft),
      })
      setConstitution(result.constitution)
      setConstitutionDraft(null)
      setEditingConstitution(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The canon constitution could not be saved.')
      void api<{ constitution: CanonConstitution }>('/api/campaign/canon/constitution', { headers: authorization }).then(({ constitution: latest }) => setConstitution(latest))
    } finally {
      setPending('')
    }
  }

  const extractCanon = async () => {
    setExtracting(true)
    setError('')
    try {
      onLedger(await api<CanonLedger>('/api/campaign/canon/extract', { method: 'POST', headers: authorization }))
      void api<{ sessions: CampaignSession[] }>('/api/campaign/sessions', { headers: authorization }).then(({ sessions }) => setCampaignSessions(sessions))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The transcript could not be read for canon.')
    } finally {
      setExtracting(false)
    }
  }

  const closeCampaignSession = async () => {
    if (!sessionTitle.trim()) return
    setPending('close-session')
    setError('')
    try {
      const result = await api<{ sessions: CampaignSession[] }>('/api/campaign/sessions/close', {
        method: 'POST', headers: authorization, body: JSON.stringify({ title: sessionTitle }),
      })
      setCampaignSessions(result.sessions)
      setSelectedSessionId(result.sessions[0]?.id ?? '')
      setSessionTitle('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The campaign session could not be closed.')
    } finally {
      setPending('')
    }
  }

  const beginEntryAction = (entry: CanonEntry, action: 'revise' | 'supersede' | 'retract') => {
    setEntryMode({ entry, action })
    setEntryTitle(entry.title)
    setEntryClaim(entry.claim)
    setEntryVisibility(entry.visibility)
    setEntryReason('')
  }

  const saveEntryAction = async () => {
    if (!entryMode) return
    setPending(entryMode.entry.id)
    setError('')
    try {
      const retracting = entryMode.action === 'retract'
      const result = await api<CanonLedger & { entry: CanonEntry }>(`/api/campaign/canon/entries/${entryMode.entry.id}`, {
        method: retracting ? 'DELETE' : 'PATCH',
        headers: authorization,
        body: JSON.stringify(retracting
          ? { revision: entryMode.entry.revision, reason: entryReason }
          : { action: entryMode.action, title: entryTitle, claim: entryClaim, visibility: entryVisibility, revision: entryMode.entry.revision, reason: entryReason }),
      })
      onLedger({ proposals: result.proposals, entries: result.entries, coverage: result.coverage })
      setEntryMode(null)
      setEntryHistory((current) => {
        if (!(entryMode.entry.id in current)) return current
        const next = { ...current }
        delete next[entryMode.entry.id]
        return next
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The canon entry could not be changed.')
    } finally {
      setPending('')
    }
  }

  const toggleHistory = async (entry: CanonEntry) => {
    if (entryHistory[entry.id]) {
      setEntryHistory((current) => {
        const next = { ...current }
        delete next[entry.id]
        return next
      })
      return
    }
    try {
      const result = await api<{ revisions: CanonEntryRevision[] }>(`/api/campaign/canon/entries/${entry.id}/history`, { headers: authorization })
      setEntryHistory((current) => ({ ...current, [entry.id]: result.revisions }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The canon history could not be opened.')
    }
  }

  const prepareContinuityBrief = async () => {
    setContinuityPending(true)
    setError('')
    try {
      const result = await api<{ brief: ContinuityBrief }>('/api/campaign/continuity/extract', { method: 'POST', headers: authorization, body: JSON.stringify({ sessionId: selectedSessionId }) })
      setContinuityBrief(result.brief)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The continuity brief could not be prepared.')
    } finally {
      setContinuityPending(false)
    }
  }

  const checkContradictions = async () => {
    setContradictionsPending(true)
    setError('')
    try {
      const result = await api<{ report: ContradictionReport }>('/api/campaign/contradictions/extract', { method: 'POST', headers: authorization, body: JSON.stringify({ sessionId: selectedSessionId }) })
      setContradictionReport(result.report)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The transcript could not be checked for contradictions.')
    } finally {
      setContradictionsPending(false)
    }
  }

  const rateContinuityThread = async (threadId: string, rating: ContinuityFeedbackRating) => {
    setPending(threadId)
    setError('')
    try {
      const result = await api<{ brief: ContinuityBrief }>(`/api/campaign/continuity/threads/${threadId}/feedback`, {
        method: 'POST', headers: authorization, body: JSON.stringify({ rating }),
      })
      setContinuityBrief(result.brief)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The continuity feedback could not be recorded.')
    } finally {
      setPending('')
    }
  }

  const pendingProposals = ledger?.proposals.filter((proposal) => proposal.status === 'proposed') ?? []
  const coverage = ledger?.coverage

  return (
    <div className="canon-layer" role="dialog" aria-modal="true" aria-labelledby="canon-ledger-heading">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close canon ledger" />
      <aside className="canon-ledger">
        <div className="drawer-heading"><span id="canon-ledger-heading">Living canon ledger</span><button className="icon-button" onClick={onClose} aria-label="Close canon ledger"><X size={18} /></button></div>
        <div className="canon-body">
          <header className="canon-heading"><span className="eyebrow">Human-kept truth</span><h2>The story as the table remembers it</h2><p>Suggested passages remain proposals until a GM accepts them. Every entry keeps its transcript trail.</p></header>
          {error && <div className="entry-error" role="alert">{error}</div>}
          {!ledger ? <span className="folio-loading">Reading the canon ledger…</span> : (
            <>
              {isGm && <section className="canon-section" aria-labelledby="campaign-sessions-heading">
                <div className="canon-section-title"><h3 id="campaign-sessions-heading">Session chapters</h3></div>
                {campaignSessions[0]?.status === 'open' ? <div className="session-chapter-current"><div><strong>Current session</strong><span>{campaignSessions[0].messageCount} transcript {campaignSessions[0].messageCount === 1 ? 'message' : 'messages'} · {campaignSessions[0].participants.map((participant) => participant.name).join(', ') || 'No speakers'}</span></div><div className="session-close-form"><input aria-label="Session title" value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} maxLength={80} placeholder="Name this session…" /><button className="folio-button" onClick={() => void closeCampaignSession()} disabled={!sessionTitle.trim() || pending === 'close-session'}>{pending === 'close-session' ? 'Closing…' : 'Close session'}</button></div></div> : <div className="canon-empty"><BookOpen size={18} /><span>The next transcript message will open a new session.</span></div>}
                {campaignSessions.length > 0 && <div className="session-context-picker"><label htmlFor="session-context">AI context session</label><select id="session-context" value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>{campaignSessions.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.messageCount} messages · {item.canonCoverage}</option>)}</select><small>Continuity and contradiction checks use this complete session, up to the 250-message safety limit.</small></div>}
              </section>}
              {isGm && <section className="canon-section" aria-labelledby="canon-constitution-heading">
                <div className="canon-section-title"><h3 id="canon-constitution-heading">Table constitution</h3>{!editingConstitution && <button className="folio-small-action" onClick={beginConstitutionEdit} disabled={!constitution}>Revise policy</button>}</div>
                {!constitution ? <span className="folio-loading">Reading the table’s canon policy…</span> : editingConstitution && constitutionDraft ? <div className="canon-constitution canon-edit">
                  <label htmlFor="constitution-threshold">What counts as canon?</label><select id="constitution-threshold" value={constitutionDraft.canonThreshold} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, canonThreshold: event.target.value as CanonConstitution['canonThreshold'] })}><option value="explicit_only">Explicit statements and rulings only</option><option value="table_consensus">Clear table consensus</option><option value="played_as_true">Facts established through play</option></select>
                  <label htmlFor="constitution-declarations">Player declarations</label><select id="constitution-declarations" value={constitutionDraft.playerDeclarations} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, playerDeclarations: event.target.value as CanonConstitution['playerDeclarations'] })}><option value="require_confirmation">Require confirmation</option><option value="stand_unless_challenged">Stand unless challenged</option></select>
                  <label htmlFor="constitution-ooc">Out-of-character talk</label><select id="constitution-ooc" value={constitutionDraft.oocPolicy} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, oocPolicy: event.target.value as CanonConstitution['oocPolicy'] })}><option value="exclude">Exclude all OOC talk</option><option value="explicit_corrections_only">Allow explicit OOC corrections only</option></select>
                  <label htmlFor="constitution-corrections">Conflicting corrections</label><select id="constitution-corrections" value={constitutionDraft.correctionPolicy} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, correctionPolicy: event.target.value as CanonConstitution['correctionPolicy'] })}><option value="latest_explicit">Latest explicit correction wins</option><option value="flag_conflicts">Keep conflicts for review</option></select>
                  <label htmlFor="constitution-visibility">Review default</label><select id="constitution-visibility" value={constitutionDraft.defaultVisibility} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, defaultVisibility: event.target.value as CanonConstitution['defaultVisibility'] })}><option value="gm_only">Keep accepted passages GM-only</option><option value="campaign">Share accepted passages with the party</option></select>
                  <label htmlFor="constitution-guidance">Table-specific guidance</label><textarea id="constitution-guidance" value={constitutionDraft.guidance} onChange={(event) => setConstitutionDraft({ ...constitutionDraft, guidance: event.target.value })} maxLength={1_000} placeholder="Names, rituals, or edge cases this table uses when deciding canon…" />
                  <div className="canon-actions"><button className="primary-action" onClick={() => void saveConstitution()} disabled={pending === 'constitution'}>{pending === 'constitution' ? 'Saving…' : 'Save constitution'}</button><button className="folio-button" onClick={() => { setEditingConstitution(false); setConstitutionDraft(null) }}>Cancel</button></div>
                </div> : <div className="canon-constitution-summary"><p>{constitution.canonThreshold === 'explicit_only' ? 'Explicit statements, commitments, and rulings can become canon.' : constitution.canonThreshold === 'table_consensus' ? 'Clear table consensus can become canon.' : 'Facts established through play can become canon.'}</p><span>World declarations: {constitution.playerDeclarations === 'require_confirmation' ? 'confirmation required' : 'stand unless challenged'} · OOC: {constitution.oocPolicy === 'exclude' ? 'excluded' : 'corrections only'} · Corrections: {constitution.correctionPolicy === 'latest_explicit' ? 'latest wins' : 'flag conflicts'}</span>{constitution.guidance && <q>{constitution.guidance}</q>}<small>Revision {constitution.revision}{constitution.updatedByName ? ` · ${constitution.updatedByName}` : ''}</small></div>}
              </section>}
              {isGm && <section className="canon-section" aria-labelledby="canon-proposals-heading">
                <div className="canon-section-title"><h3 id="canon-proposals-heading">Awaiting review</h3><div><span>{pendingProposals.length}</span><button className="folio-small-action" onClick={() => void extractCanon()} disabled={extracting || !coverage?.unscannedCount}>{extracting ? 'Reading…' : coverage?.unscannedCount ? 'Find passages' : 'Up to date'}</button></div></div>
                {coverage && <p className="canon-coverage">{coverage.unscannedCount > 0 ? `${coverage.unscannedCount} new transcript ${coverage.unscannedCount === 1 ? 'message' : 'messages'} ready to scan.` : coverage.latestSequence > 0 ? 'The transcript is scanned through its latest message.' : 'The transcript has no messages to scan yet.'}</p>}
                {!pendingProposals.length && <div className="canon-empty"><Check size={18} /><span>No passages await a ruling.</span></div>}
                {pendingProposals.map((proposal) => (
                  <article className="canon-card" key={proposal.id}>
                    <div className="canon-card-meta"><span>{proposal.kind}</span><span>{proposal.visibility === 'gm_only' ? 'GM only' : 'Whole campaign'}</span><span>AI suggestion</span></div>
                    {editing?.id === proposal.id ? (
                      <div className="canon-edit">
                        <label htmlFor={`canon-title-${proposal.id}`}>Canon title</label><input id={`canon-title-${proposal.id}`} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={80} />
                        <label htmlFor={`canon-claim-${proposal.id}`}>Canon wording</label><textarea id={`canon-claim-${proposal.id}`} value={editClaim} onChange={(event) => setEditClaim(event.target.value)} maxLength={2_000} />
                        <label htmlFor={`canon-visibility-${proposal.id}`}>Who can read this?</label><select id={`canon-visibility-${proposal.id}`} value={editVisibility} onChange={(event) => setEditVisibility(event.target.value as 'campaign' | 'gm_only')}><option value="gm_only">Keep GM-only</option><option value="campaign">Share with party</option></select>
                      </div>
                    ) : <><h4>{proposal.title}</h4><p>{proposal.claim}</p></>}
                    <div className="canon-citations" aria-label="Transcript citations">{proposal.sources.map((source) => <button key={source.messageId} onClick={() => { onOpenSource(source); onClose() }} aria-label={`Open citation from ${source.senderName} in ${source.roomName}`}><Hash size={11} /><span>{source.roomName} · {source.senderName}</span><q>{source.excerpt ?? source.text}</q></button>)}</div>
                    <div className="canon-actions">
                      {editing?.id === proposal.id ? <><button className="primary-action" disabled={!editTitle.trim() || !editClaim.trim() || pending === proposal.id} onClick={() => void decide(proposal, 'edit_accept', undefined, editVisibility)}>{pending === proposal.id ? 'Recording…' : editVisibility === 'campaign' ? 'Edit and share' : 'Keep edited passage private'}</button><button className="folio-button" onClick={() => setEditing(null)}>Cancel</button></> : <><button className="primary-action" disabled={pending === proposal.id} onClick={() => void decide(proposal, 'accept', undefined, constitution?.defaultVisibility ?? 'gm_only')}>{constitution?.defaultVisibility === 'campaign' ? 'Share with party' : 'Keep GM-only'}</button><button className="folio-button" disabled={pending === proposal.id} onClick={() => void decide(proposal, 'accept', undefined, constitution?.defaultVisibility === 'campaign' ? 'gm_only' : 'campaign')}>{constitution?.defaultVisibility === 'campaign' ? 'Keep GM-only' : 'Share with party'}</button><button className="folio-button" onClick={() => beginEditing(proposal)}>Edit first</button><button className="folio-button" disabled={pending === proposal.id} onClick={() => void decide(proposal, 'dispute', 'incorrect')}>Incorrect</button><button className="folio-button" disabled={pending === proposal.id} onClick={() => void decide(proposal, 'reject', 'secret_leak')}>Secret leak</button><button className="folio-button" disabled={pending === proposal.id} onClick={() => void decide(proposal, 'reject', 'not_useful')}>Not useful</button></>}
                    </div>
                  </article>
                ))}
              </section>}
              <section className="canon-section" aria-labelledby="accepted-canon-heading">
                <div className="canon-section-title"><h3 id="accepted-canon-heading">Accepted canon</h3><span>{ledger.entries.length}</span></div>
                {!ledger.entries.length && <div className="canon-empty"><BookOpen size={18} /><span>No passages have been accepted yet.</span></div>}
                {ledger.entries.map((entry) => <article className="canon-entry" key={entry.id}>
                  <div className="canon-card-meta"><span>{entry.kind}</span><span>{entry.visibility === 'gm_only' ? 'GM only' : 'Whole campaign'}</span><span>Revision {entry.revision}</span></div>
                  {entryMode?.entry.id === entry.id ? <div className="canon-edit">
                    <strong>{entryMode.action === 'retract' ? 'Retract this passage?' : entryMode.action === 'supersede' ? 'Supersede this version' : 'Revise this passage'}</strong>
                    {entryMode.action !== 'retract' && <><label htmlFor={`entry-title-${entry.id}`}>Canon title</label><input id={`entry-title-${entry.id}`} value={entryTitle} onChange={(event) => setEntryTitle(event.target.value)} maxLength={80} /><label htmlFor={`entry-claim-${entry.id}`}>Canon wording</label><textarea id={`entry-claim-${entry.id}`} value={entryClaim} onChange={(event) => setEntryClaim(event.target.value)} maxLength={2_000} /><label htmlFor={`entry-visibility-${entry.id}`}>Who can read this?</label><select id={`entry-visibility-${entry.id}`} value={entryVisibility} onChange={(event) => setEntryVisibility(event.target.value as 'campaign' | 'gm_only')}><option value="gm_only">Keep GM-only</option><option value="campaign">Share with party</option></select></>}
                    <label htmlFor={`entry-reason-${entry.id}`}>{entryMode.action === 'revise' ? 'Reason (optional)' : 'Reason'}</label><input id={`entry-reason-${entry.id}`} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} maxLength={500} placeholder={entryMode.action === 'retract' ? 'Why should the table stop relying on this?' : 'What changed?'} />
                    <div className="canon-actions"><button className={entryMode.action === 'retract' ? 'folio-button folio-button--danger' : 'primary-action'} disabled={pending === entry.id || !entryTitle.trim() || !entryClaim.trim() || (entryMode.action !== 'revise' && !entryReason.trim())} onClick={() => void saveEntryAction()}>{pending === entry.id ? 'Recording…' : entryMode.action === 'retract' ? 'Confirm retraction' : entryMode.action === 'supersede' ? 'Record new version' : 'Save revision'}</button><button className="folio-button" onClick={() => setEntryMode(null)}>Cancel</button></div>
                  </div> : <><h4>{entry.title}</h4><p>{entry.claim}</p></>}
                  <div className="canon-citations">{entry.sources.map((source) => <button key={source.messageId} onClick={() => { onOpenSource(source); onClose() }} aria-label={`Open citation from ${source.senderName} in ${source.roomName}`}><Hash size={11} /><span>{source.roomName} · {source.senderName}</span></button>)}</div>
                  <small>Accepted by {entry.createdByName ?? 'a GM'}</small>
                  <div className="canon-actions"><button className="folio-button" onClick={() => void toggleHistory(entry)}>{entryHistory[entry.id] ? 'Hide history' : 'History'}</button>{isGm && <><button className="folio-button" onClick={() => beginEntryAction(entry, 'revise')}>Edit</button><button className="folio-button" onClick={() => beginEntryAction(entry, 'supersede')}>Supersede</button><button className="folio-button" onClick={() => beginEntryAction(entry, 'retract')}>Retract</button></>}</div>
                  {entryHistory[entry.id] && <ol className="canon-history">{entryHistory[entry.id].map((revision) => <li key={revision.id}><span>Revision {revision.revision} · {revision.action}</span><strong>{revision.title}</strong><p>{revision.claim}</p><small>{revision.createdByName}{revision.reason ? ` · ${revision.reason}` : ''}</small></li>)}</ol>}
                </article>)}
              </section>
              {isGm && <section className="canon-section" aria-labelledby="contradictions-heading">
                <div className="canon-section-title"><h3 id="contradictions-heading">Contradiction watch</h3><button className="folio-small-action" onClick={() => void checkContradictions()} disabled={contradictionsPending || !ledger.entries.length || !selectedSessionId}>{contradictionsPending ? 'Checking…' : contradictionReport ? 'Check again' : 'Check session'}</button></div>
                {!ledger.entries.length ? <div className="canon-empty"><BookMarked size={18} /><span>Accept canon before checking it against the transcript.</span></div> : !contradictionReport && contradictionsLoaded ? <div className="canon-empty"><BookMarked size={18} /><span>No private contradiction check has been prepared.</span></div> : contradictionReport && <><p className="continuity-note">Private to GMs · checked {new Date(contradictionReport.createdAt).toLocaleString()}</p>{!contradictionReport.findings.length && <div className="canon-empty"><Check size={18} /><span>No well-supported contradictions were found.</span></div>}{contradictionReport.findings.map((finding) => <article className="contradiction-card" key={finding.id}>
                  <div className="canon-card-meta"><span>Private check</span><span>Read only</span></div><h4>{finding.title}</h4><p>{finding.explanation}</p>
                  <div className="contradiction-canon"><strong>Canon under question</strong><span>{finding.canonTitle}</span><q>{finding.canonClaim}</q></div>
                  <div className="canon-citations">{finding.sources.map((source) => <button key={source.messageId} onClick={() => { onOpenSource(source); onClose() }} aria-label={`Open contradiction citation from ${source.senderName} in ${source.roomName}`}><Hash size={11} /><span>{source.roomName} · {source.senderName}</span><q>{source.excerpt ?? source.text}</q></button>)}</div>
                </article>)}</>}
              </section>}
              {isGm && <section className="canon-section" aria-labelledby="continuity-heading">
                <div className="canon-section-title"><h3 id="continuity-heading">Session continuity</h3><button className="folio-small-action" onClick={() => void prepareContinuityBrief()} disabled={continuityPending || !selectedSessionId}>{continuityPending ? 'Reading…' : continuityBrief ? 'Refresh brief' : 'Prepare brief'}</button></div>
                {!continuityBrief && continuityLoaded && <div className="canon-empty"><BookMarked size={18} /><span>No private continuity brief has been prepared.</span></div>}
                {continuityBrief && <><p className="continuity-note">Private to GMs · prepared {new Date(continuityBrief.createdAt).toLocaleString()}</p>{!continuityBrief.threads.length && <div className="canon-empty"><Check size={18} /><span>No well-supported loose threads were found.</span></div>}{continuityBrief.threads.map((thread) => <article className="continuity-card" key={thread.id}>
                  <div className="canon-card-meta"><span>GM only</span><span>{Math.round(thread.confidence * 100)}% confidence</span></div><h4>{thread.title}</h4><p>{thread.summary}</p><strong>Why it matters</strong><p>{thread.whyItMatters}</p>
                  <div className="canon-citations">{thread.sources.map((source) => <button key={source.messageId} onClick={() => { onOpenSource(source); onClose() }} aria-label={`Open continuity citation from ${source.senderName} in ${source.roomName}`}><Hash size={11} /><span>{source.roomName} · {source.senderName}</span><q>{source.excerpt ?? source.text}</q></button>)}</div>
                  <div className="canon-actions" aria-label={`Feedback for ${thread.title}`}><button className="folio-button" disabled={pending === thread.id} onClick={() => void rateContinuityThread(thread.id, 'useful')}>Useful</button><button className="folio-button" disabled={pending === thread.id} onClick={() => void rateContinuityThread(thread.id, 'incorrect')}>Incorrect</button><button className="folio-button" disabled={pending === thread.id} onClick={() => void rateContinuityThread(thread.id, 'secret_leak')}>Secret leak</button><button className="folio-button" disabled={pending === thread.id} onClick={() => void rateContinuityThread(thread.id, 'not_useful')}>Not useful</button>{thread.feedback && <span className="continuity-feedback">Recorded: {thread.feedback.rating.replace('_', ' ')}</span>}</div>
                </article>)}</>}
              </section>}
            </>
          )}
        </div>
      </aside>
    </div>
  )
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

function EntryGate({ inviteCode, recoverySeed, pendingEntry, savedSeats, switchingCampaign, notice, onEnter, onSelectSaved }: { inviteCode: string | null; recoverySeed: RecoverySeed | null; pendingEntry: SeatEntry | null; savedSeats: SavedSeat[]; switchingCampaign: string; notice?: string; onEnter: (session: TableSession) => void; onSelectSaved: (seat: SavedSeat) => void }) {
  const [playerName, setPlayerName] = useState(recoverySeed?.playerName ?? '')
  const [campaignName, setCampaignName] = useState('')
  const [recoveryCode, setRecoveryCode] = useState(recoverySeed?.recoveryCode ?? '')
  const [recovering, setRecovering] = useState(Boolean(recoverySeed))
  const [issuedEntry, setIssuedEntry] = useState<SeatEntry | null>(pendingEntry)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!playerName.trim() || (!inviteCode && !campaignName.trim()) || (recovering && !recoveryCode.trim())) return
    setError('')
    setSubmitting(true)
    try {
      const path = recovering && inviteCode ? `/api/invitations/${inviteCode}/recover` : inviteCode ? `/api/invitations/${inviteCode}/join` : '/api/campaigns'
      const session = await api<SeatEntry>(path, {
        method: 'POST',
        body: JSON.stringify(recovering ? { playerName, recoveryCode } : inviteCode ? { playerName } : { campaignName, playerName }),
      })
      sessionStorage.setItem(pendingSeatEntryKey, JSON.stringify(session))
      setIssuedEntry(session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to enter the table.')
    } finally {
      setSubmitting(false)
    }
  }

  if (issuedEntry) {
    return <main className="entry-gate"><div className="entry-card entry-card--seat-key"><SeatKeyPanel inviteCode={issuedEntry.campaign.inviteCode} playerName={issuedEntry.player.name} recoveryCode={issuedEntry.recoveryCode} onDone={() => { sessionStorage.removeItem(pendingSeatEntryKey); onEnter(issuedEntry) }} /></div></main>
  }

  return (
    <main className="entry-gate">
      <div className="entry-card">
        <div className="campaign-sigil entry-sigil"><BookOpen size={21} /></div>
        <span className="campaign-kicker">Wayfarer's Table</span>
        <h1>{recovering ? 'Recover your seat' : inviteCode ? 'Join the campaign' : 'Open a new campaign'}</h1>
        <p>{recovering ? 'Enter the private key you saved when this seat was created.' : inviteCode ? 'Choose the name the party will see at the table.' : 'Name the campaign and take the first seat.'}</p>
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
          {recovering && <><label htmlFor="recovery-code">Seat key</label><input id="recovery-code" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" spellCheck={false} /></>}
          {error && <div className="entry-error" role="alert">{error}</div>}
          <button className="primary-action" type="submit" disabled={submitting || !playerName.trim() || (!inviteCode && !campaignName.trim()) || (recovering && !recoveryCode.trim())}>
            {submitting ? 'Opening…' : recovering ? 'Recover the seat' : inviteCode ? 'Join the table' : 'Open the table'}
          </button>
          {inviteCode && <button className="entry-switch" type="button" onClick={() => { setRecovering((current) => !current); setError('') }}>{recovering ? 'Join with a new name' : 'Recover an existing seat'}</button>}
        </form>
        {!inviteCode && savedSeats.length > 0 && <div className="saved-seat-list">
          <span>Or return to a saved campaign</span>
          {savedSeats.map((seat) => <button key={seat.campaignId} type="button" onClick={() => onSelectSaved(seat)} disabled={Boolean(switchingCampaign)}>
            <span><strong>{seat.campaignName}</strong><small>{seat.playerName}{seat.role === 'owner' ? ' · Owner · GM' : seat.knowledgeRole === 'gm' ? ' · GM' : ''}</small></span>
            {switchingCampaign === seat.campaignId ? <RefreshCw className="spinning" size={14} /> : <BookOpen size={14} />}
          </button>)}
        </div>}
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
  unreadRooms,
  participants,
  currentPlayer,
  onRoomChange,
  mobile,
  onClose,
}: {
  rooms: CampaignRoom[]
  activeRoom: string
  unreadRooms: Record<string, number>
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
              <Hash size={15} /><span>{room.name}</span>{Boolean(unreadRooms[room.id]) && <span className="unread-count" aria-label={`${unreadRooms[room.id]} unread messages`}>{unreadRooms[room.id] > 99 ? '99+' : unreadRooms[room.id]}</span>}
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

function MessageItem({ message, highlighted = false }: { message: RoomMessage; highlighted?: boolean }) {
  const participant: Participant = { playerId: message.senderId, name: message.senderName, muted: false }
  const time = new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <article className={`message ${highlighted ? 'message--highlighted' : ''}`} id={`message-${message.id}`}>
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
  onOpenInvitation,
}: {
  session: TableSession
  onClose: () => void
  onCampaign: (campaign: Campaign) => void
  onOpenInvitation: () => void
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
  const [issuedRecovery, setIssuedRecovery] = useState<{ playerId: string; playerName: string; recoveryCode: string } | null>(null)
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

  const resetRecovery = (playerId: string, playerName: string) => {
    const key = `recovery-${playerId}`
    if (confirming !== key) { setConfirming(key); setIssuedRecovery(null); return }
    void run(key, async () => {
      const result = await api<{ recoveryCode: string }>(`/api/campaign/players/${playerId}/recovery`, { method: 'POST', headers: authorization })
      setIssuedRecovery({ playerId, playerName, recoveryCode: result.recoveryCode })
      setConfirming('')
    })
  }

  const changeKnowledgeRole = (player: CampaignManagement['players'][number]) => {
    const knowledgeRole = player.knowledgeRole === 'gm' ? 'player' : 'gm'
    const key = `knowledge-${player.id}-${knowledgeRole}`
    if (confirming !== key) { setConfirming(key); return }
    void run(key, async () => {
      const result = await api<CampaignManagement>(`/api/campaign/players/${player.id}/knowledge-role`, {
        method: 'PATCH', headers: authorization, body: JSON.stringify({ knowledgeRole }),
      })
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
              <button className="folio-button" onClick={onOpenInvitation}><QrCode size={15} /> Open invitation</button>
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
            {!management ? <span className="folio-loading">Reading the ledger…</span> : <div className="folio-player-list">{management.players.map((player) => (
              <div className="folio-player-entry" key={player.id}>
                <div className="folio-player"><Avatar participant={{ playerId: player.id, name: player.name, muted: false }} size="small" /><span><strong>{player.name}</strong><small>{player.role === 'owner' ? 'Campaign owner · GM' : player.knowledgeRole === 'gm' ? 'GM' : 'Player'}</small></span><div className="folio-row-actions">{player.role !== 'owner' && <button className={confirming === `knowledge-${player.id}-${player.knowledgeRole === 'gm' ? 'player' : 'gm'}` ? 'knowledge-action--confirm' : ''} onClick={() => changeKnowledgeRole(player)} disabled={pending.startsWith(`knowledge-${player.id}-`)} aria-label={confirming === `knowledge-${player.id}-${player.knowledgeRole === 'gm' ? 'player' : 'gm'}` ? `Confirm ${player.knowledgeRole === 'gm' ? 'revoke' : 'grant'} GM access for ${player.name}` : `${player.knowledgeRole === 'gm' ? 'Revoke' : 'Grant'} GM access for ${player.name}`}><BookMarked size={15} /></button>}<button className={confirming === `recovery-${player.id}` ? 'danger-action' : ''} onClick={() => resetRecovery(player.id, player.name)} disabled={pending === `recovery-${player.id}`} aria-label={confirming === `recovery-${player.id}` ? `Confirm reset seat key for ${player.name}` : `Reset seat key for ${player.name}`}><KeyRound size={15} /></button>{player.role !== 'owner' && <button className={confirming === `remove-${player.id}` ? 'danger-action' : ''} onClick={() => removePlayer(player.id)} disabled={pending === `remove-${player.id}`} aria-label={confirming === `remove-${player.id}` ? `Confirm remove ${player.name}` : `Remove ${player.name}`}><UserMinus size={15} /></button>}</div></div>
                {issuedRecovery?.playerId === player.id && <SeatKeyPanel compact inviteCode={session.campaign.inviteCode} playerName={issuedRecovery.playerName} recoveryCode={issuedRecovery.recoveryCode} onDone={() => setIssuedRecovery(null)} />}
              </div>
            ))}</div>}
          </section>
        </div>
      </aside>
    </div>
  )
}

function App() {
  const [inviteCode, setInviteCode] = useState(readInvitationCode)
  const [recoverySeed] = useState(readRecoverySeed)
  const [pendingSeatEntry] = useState(readPendingSeatEntry)
  const [savedSeats, setSavedSeats] = useState(readSavedSeats)
  const [session, setSession] = useState<TableSession | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [restoringSession, setRestoringSession] = useState(() => !recoverySeed && !pendingSeatEntry && Boolean(seatToRestore(readInvitationCode())))
  const [campaignMenu, setCampaignMenu] = useState(false)
  const [switchingCampaign, setSwitchingCampaign] = useState('')
  const [campaignSwitchError, setCampaignSwitchError] = useState('')
  const [activeRoom, setActiveRoom] = useState('')
  const activeRoomRef = useRef(activeRoom)
  const [unreadRooms, setUnreadRooms] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [historyError, setHistoryError] = useState('')
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
  const [invitationSheet, setInvitationSheet] = useState(false)
  const [transcriptSearch, setTranscriptSearch] = useState(false)
  const [sharedNotes, setSharedNotes] = useState(false)
  const [canonLedger, setCanonLedger] = useState(false)
  const [campaignCanon, setCampaignCanon] = useState<CanonLedger | null>(null)
  const [targetMessageId, setTargetMessageId] = useState('')
  const [campaignNote, setCampaignNote] = useState<CampaignNote | null>(null)
  const clientRef = useRef<RealtimeClient | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const audioRef = useRef(new Map<string, HTMLAudioElement>())
  const candidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const iceServersRef = useRef<RTCIceServer[]>([])
  const recoveryAttemptsRef = useRef(new Map<string, number>())
  const recoveryTimersRef = useRef(new Map<string, number>())
  const timelineRef = useRef<HTMLDivElement>(null)
  const preserveTimelineHeightRef = useRef<number | null>(null)
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
    if (session || recoverySeed || pendingSeatEntry) return
    const savedSeat = seatToRestore(inviteCode)
    if (!savedSeat) return
    void api<TableSession>('/api/session', { headers: { authorization: `Bearer ${savedSeat.token}` } })
      .then((restored) => {
        if (inviteCode && restored.campaign.inviteCode !== inviteCode) return
        const roomId = restored.campaign.rooms[0]?.id ?? ''
        activeRoomRef.current = roomId
        setActiveRoom(roomId)
        setSession(restored)
        setSavedSeats(saveSeat(restored))
      })
      .catch(() => setSavedSeats(forgetSeat(savedSeat.campaignId)))
      .finally(() => setRestoringSession(false))
  }, [inviteCode, recoverySeed, pendingSeatEntry, session])

  useEffect(() => { localStorage.setItem('wayfarer-draft', draft) }, [draft])
  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    if (preserveTimelineHeightRef.current !== null) {
      timeline.scrollTop += timeline.scrollHeight - preserveTimelineHeightRef.current
      preserveTimelineHeightRef.current = null
      return
    }
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' })
  }, [messages])
  useEffect(() => {
    if (!targetMessageId || !messages.some((message) => message.id === targetMessageId)) return
    document.getElementById(`message-${targetMessageId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setTargetMessageId(''), 3_000)
    return () => window.clearTimeout(timer)
  }, [messages, targetMessageId])

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
        setSavedSeats(forgetSeat(realtimePlayer.campaignId))
        client.close()
        setEntryNotice(event.payload.reason === 'recovered' ? 'This seat was recovered in another browser.' : 'Your seat was removed from this campaign.')
        setSession(null)
        setActiveRoom('')
        setUnreadRooms({})
        activeRoomRef.current = ''
        return
      }
      if (event.type === 'session.updated') {
        setSavedSeats(updateSavedPlayer(event.payload.player))
        setSession((current) => current ? { ...current, player: event.payload.player } : current)
        setCampaignCanon(null)
        setCanonLedger(false)
        return
      }
      if (event.type === 'campaign.updated') {
        const campaign = event.payload.campaign
        setSession((current) => current ? { ...current, campaign } : current)
        setUnreadRooms((current) => Object.fromEntries(Object.entries(current).filter(([roomId]) => campaign.rooms.some((room) => room.id === roomId))))
        showInvitationInUrl(campaign.inviteCode)
        setInviteCode(campaign.inviteCode)
        setSavedSeats(saveSeat({ campaign, player: realtimePlayer }))
        if (!campaign.rooms.some((room) => room.id === activeRoomRef.current)) {
          const roomId = campaign.rooms[0]?.id ?? ''
          activeRoomRef.current = roomId
          setActiveRoom(roomId)
          setMessages([])
          setHasOlderMessages(false)
          setHistoryError('')
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
      if (event.type === 'room.activity') {
        if (event.payload.senderId !== realtimePlayer.id && event.roomId !== activeRoomRef.current) setUnreadRooms((current) => ({ ...current, [event.roomId]: (current[event.roomId] ?? 0) + 1 }))
        return
      }
      if (event.type === 'campaign.note_updated') {
        setCampaignNote(event.payload.note)
        return
      }
      if (event.type === 'campaign.canon_updated') {
        setCampaignCanon(event.payload)
        return
      }
      if (event.roomId !== activeRoomRef.current) return
      if (event.type === 'room.snapshot') {
        setMessages(event.payload.messages)
        setHasOlderMessages(event.payload.hasMore)
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
        void api<{ unreadRooms: Record<string, number> }>('/api/campaign/activity', { headers: { authorization: `Bearer ${realtimePlayer.token}` } })
          .then(({ unreadRooms: durableUnread }) => {
            const active = activeRoomRef.current
            setUnreadRooms(Object.fromEntries(Object.entries(durableUnread).filter(([roomId]) => roomId !== active)))
          })
          .catch(() => undefined)
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
    setSavedSeats(saveSeat(entered))
    const roomId = entered.campaign.rooms[0]?.id ?? ''
    activeRoomRef.current = roomId
    setActiveRoom(roomId)
    setSession(entered)
    setEntryNotice('')
    showInvitationInUrl(entered.campaign.inviteCode)
    setInviteCode(entered.campaign.inviteCode)
  }

  const updateCampaign = (campaign: Campaign) => {
    setSession((current) => current ? { ...current, campaign } : current)
    if (session) setSavedSeats(saveSeat({ ...session, campaign }))
    showInvitationInUrl(campaign.inviteCode)
    setInviteCode(campaign.inviteCode)
  }

  const switchCampaign = async (seat: SavedSeat) => {
    if (seat.campaignId === session?.campaign.id || switchingCampaign) { setCampaignMenu(false); return }
    setSwitchingCampaign(seat.campaignId)
    setCampaignSwitchError('')
    setEntryNotice('')
    try {
      const restored = await api<TableSession>('/api/session', { headers: { authorization: `Bearer ${seat.token}` } })
      setMessages([])
      setHasOlderMessages(false)
      setHistoryError('')
      setParticipants([])
      setVoiceParticipants([])
      setPeerConnectionStates({})
      setCampaignNote(null)
      setCampaignCanon(null)
      setJoinedVoice(false)
      enterTable(restored)
      setCampaignMenu(false)
    } catch {
      setSavedSeats(forgetSeat(seat.campaignId))
      const notice = `The saved seat for ${seat.campaignName} is no longer available.`
      setCampaignSwitchError(notice)
      setEntryNotice(notice)
    } finally {
      setSwitchingCampaign('')
    }
  }

  const openNewCampaign = () => {
    localStorage.removeItem(activeCampaignKey)
    setCampaignMenu(false)
    setSession(null)
    setActiveRoom('')
    activeRoomRef.current = ''
    setMessages([])
    setParticipants([])
    setVoiceParticipants([])
    setUnreadRooms({})
    setJoinedVoice(false)
    setInviteCode(null)
    const url = new URL(location.href)
    url.searchParams.delete('invite')
    url.hash = ''
    history.replaceState({}, '', url)
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
    setUnreadRooms((current) => {
      if (!current[roomId]) return current
      const next = { ...current }
      delete next[roomId]
      return next
    })
    if (joinedVoice) leaveVoice()
    activeRoomRef.current = roomId
    setActiveRoom(roomId)
    setMessages([])
    setHasOlderMessages(false)
    setHistoryError('')
    setParticipants([])
    setVoiceParticipants([])
    setPeerConnectionStates({})
    if (connection === 'live') clientRef.current?.send(createEvent('room.subscribe', roomId, {}))
  }

  const openCanonSource = (source: CanonProposalSource) => {
    setTargetMessageId(source.messageId)
    changeRoom(source.roomId)
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
    if (clientRef.current?.send(createEvent('chat.send', activeRoom, { clientMessageId, text }))) setDraft('')
  }

  const loadEarlierMessages = async () => {
    const oldest = messages[0]?.sequence
    if (!oldest || loadingOlderMessages || !hasOlderMessages || !session) return
    setLoadingOlderMessages(true)
    setHistoryError('')
    try {
      const timeline = timelineRef.current
      preserveTimelineHeightRef.current = timeline?.scrollHeight ?? null
      const page = await api<MessagePage>(`/api/rooms/${activeRoom}/messages?before=${oldest}`, { headers: { authorization: `Bearer ${session.player.token}` } })
      setMessages((current) => [...new Map([...page.messages, ...current].map((message) => [message.id, message])).values()].sort((left, right) => left.sequence - right.sequence))
      setHasOlderMessages(page.hasMore)
    } catch {
      preserveTimelineHeightRef.current = null
      setHistoryError('Earlier entries could not be read. Try again.')
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
  }

  if (restoringSession) return <main className="entry-gate"><span className="entry-wait">Returning to the table…</span></main>
  if (!session) return <EntryGate inviteCode={inviteCode} recoverySeed={recoverySeed} pendingEntry={pendingSeatEntry} savedSeats={savedSeats} switchingCampaign={switchingCampaign} notice={entryNotice} onEnter={enterTable} onSelectSaved={(seat) => void switchCampaign(seat)} />
  if (!activeRoomData) return null

  return (
    <div className="app-shell">
      <header className="campaign-bar">
        <div className="campaign-identity">
          <button className="icon-button mobile-only" onClick={() => setMobileLedger(true)} aria-label="Open campaign navigation"><Menu size={19} /></button>
          <div className="campaign-sigil" aria-hidden="true"><BookOpen size={18} /></div>
          <div className="campaign-switcher">
            <span className="campaign-kicker">Wayfarer's Table</span>
            <button className="campaign-title" onClick={() => setCampaignMenu((open) => !open)} aria-expanded={campaignMenu} aria-haspopup="menu" aria-label="Switch campaign">
              <span>{session.campaign.name}</span><ChevronDown size={13} />
            </button>
            {campaignMenu && <div className="campaign-menu" role="menu" aria-label="Saved campaigns">
              <span className="campaign-menu-label">Your campaigns</span>
              {campaignSwitchError && <span className="campaign-menu-error" role="alert">{campaignSwitchError}</span>}
              {savedSeats.map((seat) => <button key={seat.campaignId} type="button" role="menuitem" className="campaign-menu-seat" onClick={() => void switchCampaign(seat)} disabled={Boolean(switchingCampaign)}>
                <span><strong>{seat.campaignName}</strong><small>{seat.playerName}{seat.role === 'owner' ? ' · Owner · GM' : seat.knowledgeRole === 'gm' ? ' · GM' : ''}</small></span>
                {seat.campaignId === session.campaign.id ? <Check size={15} /> : switchingCampaign === seat.campaignId ? <RefreshCw className="spinning" size={14} /> : null}
              </button>)}
              <button type="button" role="menuitem" className="campaign-menu-new" onClick={openNewCampaign}><Plus size={15} />Open new campaign</button>
            </div>}
          </div>
        </div>
        <div className="campaign-actions">
          {connection !== 'live' && <span className="connection-state"><i />{connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>}
          <button className="text-button" onClick={() => setTranscriptSearch(true)}><Search size={15} />Search</button>
          <button className="text-button" onClick={() => setSharedNotes(true)}><NotebookPen size={15} />Notes</button>
          <button className="text-button" onClick={() => setCanonLedger(true)}><BookMarked size={15} />Canon</button>
          <button className="text-button invite-button" onClick={() => setInvitationSheet(true)}><QrCode size={15} />Invite players</button>
          {session.player.role === 'owner' && <button className="icon-button" onClick={() => setCampaignFolio(true)} aria-label="Open campaign folio"><Settings size={18} /></button>}
          <button className="icon-button mobile-only" onClick={() => setMobileTable(true)} aria-label="Open voice table"><Users size={19} /></button>
        </div>
      </header>

      <CampaignLedger rooms={rooms} activeRoom={activeRoom} unreadRooms={unreadRooms} participants={participants} currentPlayer={currentPlayer} onRoomChange={changeRoom} />

      <main className="conversation">
        <header className="room-heading"><div><div className="room-title"><Hash size={19} /><h1>{activeRoomData.name}</h1></div><p>{activeRoomData.description}</p></div></header>
        <div className="timeline" ref={timelineRef} aria-live="polite" aria-label={`${activeRoomData.name} messages`}>
          {hasOlderMessages && <button className="earlier-entries" onClick={loadEarlierMessages} disabled={loadingOlderMessages}><span /><strong>{loadingOlderMessages ? 'Reading earlier entries…' : 'Read earlier entries'}</strong><span /></button>}
          {historyError && <div className="history-error" role="alert">{historyError}</div>}
          {messages.length ? messages.map((message) => <MessageItem key={message.id} message={message} highlighted={message.id === targetMessageId} />) : (
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
          <CampaignLedger rooms={rooms} activeRoom={activeRoom} unreadRooms={unreadRooms} participants={participants} currentPlayer={currentPlayer} onRoomChange={changeRoom} mobile onClose={() => setMobileLedger(false)} />
        </div>
      )}

      {mobileTable && (
        <div className="drawer-layer drawer-layer--right mobile-only" role="dialog" aria-modal="true" aria-label="Voice table controls">
          <button className="drawer-scrim" onClick={() => setMobileTable(false)} aria-label="Close voice table" />
          <div className="mobile-table-drawer"><div className="drawer-heading"><span>Voice table</span><button className="icon-button" onClick={() => setMobileTable(false)} aria-label="Close voice table"><X size={18} /></button></div><VoiceTable joined={joinedVoice} joining={joiningVoice} muted={muted} pushToTalk={pushToTalk} participants={voiceParticipants} peerConnectionStates={peerConnectionStates} currentPlayerId={playerId} configReady={voiceConfigReady} error={voiceError} onJoin={joinVoice} onRetry={retryVoice} onToggleMute={() => setMuted((current) => !current)} onTogglePushToTalk={togglePushToTalk} onLeave={leaveVoice} /></div>
        </div>
      )}

      {campaignFolio && <CampaignFolio session={session} onClose={() => setCampaignFolio(false)} onCampaign={updateCampaign} onOpenInvitation={() => { setCampaignFolio(false); setInvitationSheet(true) }} />}
      {invitationSheet && <InvitationSheet campaign={session.campaign} onClose={() => setInvitationSheet(false)} />}
      {transcriptSearch && <TranscriptSearch session={session} onClose={() => setTranscriptSearch(false)} onOpenRoom={changeRoom} />}
      {sharedNotes && <SharedNotes session={session} note={campaignNote} onNote={setCampaignNote} onClose={() => setSharedNotes(false)} />}
      {canonLedger && <CanonLedgerSheet session={session} ledger={campaignCanon} onLedger={setCampaignCanon} onClose={() => setCanonLedger(false)} onOpenSource={openCanonSource} />}

      <div className="voice-dock mobile-only">
        {!joinedVoice ? <button className="primary-action" onClick={joinVoice} disabled={joiningVoice || connection !== 'live' || !voiceConfigReady}><Headphones size={17} />{joiningVoice ? 'Joining…' : voiceConfigReady ? 'Join voice' : 'Preparing voice…'}</button> : <><button className={`dock-mic ${muted ? 'dock-mic--muted' : ''}`} onClick={() => setMuted((current) => !current)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button><span>{Object.values(peerConnectionStates).includes('failed') ? 'Voice issue' : Object.values(peerConnectionStates).includes('recovering') ? 'Reconnecting voice…' : muted ? 'Muted' : `${voiceParticipants.length} in voice`}</span><button className="quiet-icon" onClick={() => setMobileTable(true)} aria-label="Voice settings"><PanelRight size={17} /></button></>}
      </div>
    </div>
  )
}

export default App
