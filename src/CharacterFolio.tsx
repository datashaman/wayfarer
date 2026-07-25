import { BookUser, LockKeyhole, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { Character, CharacterCreationContext, TableSession } from './types/protocol'

type Draft = {
  name: string
  concept: string
  appearance: string
  drive: string
  capability: string
  complication: string
  possession: string
  belief: string
  secret: string
  factionId: string
  factionConnection: string
  locationId: string
  locationConnection: string
  npcId: string
  npcConnection: string
  connectedCharacterId: string
  characterConnection: string
  expectedRevision?: number
  generatorVersion: string
}

const blankDraft = (): Draft => ({
  name: '', concept: '', appearance: '', drive: '', capability: '', complication: '',
  possession: '', belief: '', secret: '', factionId: '', factionConnection: '',
  locationId: '', locationConnection: '', npcId: '', npcConnection: '',
  connectedCharacterId: '', characterConnection: '', generatorVersion: 'manual:character-v1',
})

function draftFrom(character: Character): Draft {
  return {
    name: character.name, concept: character.concept, appearance: character.appearance,
    drive: character.drive, capability: character.capability, complication: character.complication,
    possession: character.possession, belief: character.belief, secret: character.secret ?? '',
    factionId: character.faction?.id ?? '', factionConnection: character.faction?.connection ?? '',
    locationId: character.location?.id ?? '', locationConnection: character.location?.connection ?? '',
    npcId: character.npc?.id ?? '', npcConnection: character.npc?.connection ?? '',
    connectedCharacterId: character.character?.id ?? '', characterConnection: character.character?.connection ?? '',
    expectedRevision: character.revision, generatorVersion: character.generatorVersion ?? 'manual:character-v1',
  }
}

function complete(draft: Draft) {
  return [
    draft.name, draft.concept, draft.appearance, draft.drive, draft.capability, draft.complication,
    draft.possession, draft.belief, draft.secret, draft.factionId, draft.factionConnection,
    draft.locationId, draft.locationConnection, draft.npcId, draft.npcConnection,
  ].every((value) => value.trim()) && (!draft.connectedCharacterId || draft.characterConnection.trim())
}

function ChoiceField({ legend, items, selected, onSelect }: {
  legend: string
  items: Array<{ id: string; name: string; detail: string }>
  selected: string
  onSelect: (id: string) => void
}) {
  return <fieldset className="character-choices">
    <legend>{legend}</legend>
    <div>{items.map((item) => <button key={item.id} type="button" className={selected === item.id ? 'is-chosen' : ''} onClick={() => onSelect(item.id)} aria-pressed={selected === item.id}><strong>{item.name}</strong><span>{item.detail}</span></button>)}</div>
  </fieldset>
}

export function CharacterFolio({ session, context: suppliedContext, onContext, onClose }: {
  session: TableSession
  context: CharacterCreationContext | null
  onContext: (context: CharacterCreationContext) => void
  onClose: () => void
}) {
  const authorization = useMemo(() => ({ authorization: `Bearer ${session.player.token}` }), [session.player.token])
  const [context, setContext] = useState<CharacterCreationContext | null>(suppliedContext)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [pending, setPending] = useState('load')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [concepts, setConcepts] = useState<Draft[]>([])
  const mine = context?.characters.find((character) => character.playerId === session.player.id) ?? null
  const companions = context?.characters.filter((character) => character.playerId !== session.player.id) ?? []

  useEffect(() => {
    let active = true
    api<CharacterCreationContext>('/api/campaign/characters', { headers: authorization })
      .then((result) => {
        if (!active) return
        setContext(result); onContext(result)
        const character = result.characters.find((item) => item.playerId === session.player.id)
        setDraft(character ? draftFrom(character) : blankDraft())
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'The character folio could not be read.') })
      .finally(() => { if (active) setPending('') })
    return () => { active = false }
  }, [authorization, onContext, session.player.id])

  const save = (event: FormEvent) => {
    event.preventDefault()
    setPending('save'); setError(''); setNotice('')
    void api<{ character: Character }>('/api/campaign/characters/mine', {
      method: mine ? 'PUT' : 'POST', headers: authorization,
      body: JSON.stringify({ ...draft, connectedCharacterId: draft.connectedCharacterId || null }),
    }).then(({ character }) => {
      const next = context ? { ...context, characters: [...context.characters.filter((item) => item.playerId !== character.playerId), character] } : null
      if (next) { setContext(next); onContext(next) }
      setDraft(draftFrom(character))
      setNotice(mine ? `Revision ${character.revision} is now at the table.` : `${character.name} has taken a seat at the table.`)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'The character could not be kept.'))
      .finally(() => setPending(''))
  }

  const offerConcepts = () => {
    setPending('concepts'); setError(''); setNotice('')
    void api<{ concepts: Draft[] }>('/api/campaign/characters/concepts', { method: 'POST', headers: authorization })
      .then((result) => setConcepts(result.concepts.map((concept) => ({ ...blankDraft(), ...concept }))))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'No character concepts arrived. You can keep writing by hand.'))
      .finally(() => setPending(''))
  }

  if (pending === 'load') return <div className="drawer-layer drawer-layer--right" role="dialog" aria-modal="true"><button className="drawer-scrim" onClick={onClose} aria-label="Dismiss character folio" /><aside className="character-folio"><p className="folio-loading">Opening your character folio…</p></aside></div>

  return <div className="drawer-layer drawer-layer--right" role="dialog" aria-modal="true" aria-labelledby="character-heading">
    <button className="drawer-scrim" onClick={onClose} aria-label="Dismiss character folio" />
    <aside className="character-folio">
      <div className="drawer-heading"><div><span id="character-heading">Your character</span><small>{mine ? `At the table · revision ${mine.revision}` : 'Make someone who belongs here'}</small></div><button className="icon-button" onClick={onClose} aria-label="Close character folio"><X size={18} /></button></div>
      <div className="character-folio__body">
        {error && <div className="folio-error" role="alert">{error}</div>}
        {notice && <div className="world-notice" role="status">{notice}</div>}
        {!context?.world ? <section className="character-no-world"><BookUser size={24} /><span className="eyebrow">No campaign foundation yet</span><h2>Your character needs a world to push against</h2><p>Ask a GM to establish the campaign opening first. It gives every character real people, places, and powers to be tangled with.</p></section> : <form className="character-spread" onSubmit={save}>
          <header className="character-spread__lead"><span className="eyebrow">A person in {context.world.title}</span><h2>{mine ? draft.name || 'Unnamed character' : 'Who arrives at the opening crisis?'}</h2><p>{context.world.pitch}</p>{!mine && <button type="button" className="folio-button character-offer" onClick={offerConcepts} disabled={pending === 'concepts'}>{pending === 'concepts' ? 'Listening to the world…' : concepts.length ? 'Offer three different lives' : 'Offer three lives from this world'}</button>}</header>

          {concepts.length > 0 && !mine && <section className="character-concepts" aria-labelledby="character-concepts-heading"><div className="character-section-heading"><span>Editable possibilities</span><h3 id="character-concepts-heading">Three lives already in motion</h3></div><p>Choose one to bring into the folio. Nothing is saved until you take your seat.</p><div>{concepts.map((concept) => <button type="button" key={`${concept.name}-${concept.concept}`} onClick={() => { setDraft(concept); setConcepts([]) }}><strong>{concept.name}</strong><span>{concept.concept}</span><small>{concept.drive}</small></button>)}</div></section>}

          <section className="character-half" aria-labelledby="character-public-heading"><div className="character-section-heading"><span>What the table knows</span><h3 id="character-public-heading">The face you show</h3></div>
            <label htmlFor="character-name">Name</label><input id="character-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} autoFocus />
            <label htmlFor="character-concept">In one breath</label><textarea id="character-concept" value={draft.concept} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} maxLength={240} placeholder="A disgraced ferryman who can hear the drowned town calling" />
            <label htmlFor="character-appearance">What people notice first</label><textarea id="character-appearance" value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value })} maxLength={500} />
            <div className="character-pair"><div><label htmlFor="character-drive">What you need now</label><textarea id="character-drive" value={draft.drive} onChange={(event) => setDraft({ ...draft, drive: event.target.value })} maxLength={500} /></div><div><label htmlFor="character-capability">What makes you useful</label><textarea id="character-capability" value={draft.capability} onChange={(event) => setDraft({ ...draft, capability: event.target.value })} maxLength={500} /></div></div>
            <div className="character-pair"><div><label htmlFor="character-complication">What follows you</label><textarea id="character-complication" value={draft.complication} onChange={(event) => setDraft({ ...draft, complication: event.target.value })} maxLength={500} /></div><div><label htmlFor="character-possession">What you will not lose</label><textarea id="character-possession" value={draft.possession} onChange={(event) => setDraft({ ...draft, possession: event.target.value })} maxLength={500} /></div></div>
            <label htmlFor="character-belief">A belief others can challenge</label><textarea id="character-belief" value={draft.belief} onChange={(event) => setDraft({ ...draft, belief: event.target.value })} maxLength={500} />
          </section>

          <section className="character-half character-half--connections" aria-labelledby="character-connections-heading"><div className="character-section-heading"><span>Debts, loyalties, suspicions</span><h3 id="character-connections-heading">Already caught in the world</h3></div>
            <ChoiceField legend="A faction has a claim on you" selected={draft.factionId} onSelect={(factionId) => setDraft({ ...draft, factionId })} items={context.world.factions.map((item) => ({ id: item.id, name: item.name, detail: item.goal }))} />
            <label htmlFor="faction-connection">What is the claim?</label><textarea id="faction-connection" value={draft.factionConnection} onChange={(event) => setDraft({ ...draft, factionConnection: event.target.value })} maxLength={500} />
            <ChoiceField legend="A place changed you" selected={draft.locationId} onSelect={(locationId) => setDraft({ ...draft, locationId })} items={context.world.locations.map((item) => ({ id: item.id, name: item.name, detail: item.description }))} />
            <label htmlFor="location-connection">What happened there?</label><textarea id="location-connection" value={draft.locationConnection} onChange={(event) => setDraft({ ...draft, locationConnection: event.target.value })} maxLength={500} />
            <ChoiceField legend="Someone knows your name" selected={draft.npcId} onSelect={(npcId) => setDraft({ ...draft, npcId })} items={context.world.npcs.map((item) => ({ id: item.id, name: item.name, detail: item.role }))} />
            <label htmlFor="npc-connection">What passes between you?</label><textarea id="npc-connection" value={draft.npcConnection} onChange={(event) => setDraft({ ...draft, npcConnection: event.target.value })} maxLength={500} />
            {companions.length > 0 && <><ChoiceField legend="Another character matters" selected={draft.connectedCharacterId} onSelect={(connectedCharacterId) => setDraft({ ...draft, connectedCharacterId: draft.connectedCharacterId === connectedCharacterId ? '' : connectedCharacterId })} items={companions.map((item) => ({ id: item.id, name: item.name, detail: `${item.playerName} · ${item.concept}` }))} /><label htmlFor="character-connection">What do they owe—or fear—from you?</label><textarea id="character-connection" value={draft.characterConnection} onChange={(event) => setDraft({ ...draft, characterConnection: event.target.value })} maxLength={500} /></>}
          </section>

          <section className="character-sealed" aria-labelledby="character-secret-heading"><LockKeyhole size={19} /><div><span>Sealed from the party</span><h3 id="character-secret-heading">The truth you are carrying</h3><p>Only you and the campaign’s GMs can read this.</p></div><label htmlFor="character-secret">Private secret</label><textarea id="character-secret" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} maxLength={1_000} /></section>
          <footer className="character-actions"><div><strong>{mine ? `Revision ${mine.revision}` : 'Not yet at the table'}</strong><span>Your secret stays sealed. Everything else becomes part of the party’s shared starting point.</span></div><button className="primary-action" disabled={!complete(draft) || pending === 'save'}>{pending === 'save' ? 'Taking your seat…' : mine ? 'Keep this revision' : 'Take your seat'}</button></footer>
        </form>}
      </div>
    </aside>
  </div>
}
