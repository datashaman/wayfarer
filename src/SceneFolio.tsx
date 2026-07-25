import { CircleDot, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { InPlayMaterial, InPlayMaterialKind, SceneContext, TableSession } from './types/protocol'

type SceneDraft = { title: string; framing: string; stakes: string; question: string; characterIds: string[]; locationIds: string[]; npcIds: string[]; clues: string[]; complications: string[]; sessionQuestions: string[]; expectedRevision: number | null }
type ConsequenceDraft = { entityType: 'faction' | 'location' | 'npc' | 'hook' | ''; entityId: string; state: Record<string, string>; pressure: string }
type DiscoveryDraft = { entityType: 'faction' | 'location' | 'npc' | 'hook' | ''; name: string; detail: string; tension: string; leverage: string }
const discoveryTypes = ['faction', 'location', 'npc', 'hook'] as const
const materialKinds: InPlayMaterialKind[] = ['npc', 'place', 'complication', 'consequence', 'rumour', 'treasure']
const materialCopy: Record<InPlayMaterialKind, { title: string; detail: string; pressure: string; leverage: string }> = {
  npc: { title: 'Name', detail: 'Place in the world', pressure: 'What do they want now?', leverage: 'What can they offer or threaten?' },
  place: { title: 'Name', detail: 'What is here?', pressure: 'What makes it dangerous?', leverage: 'What can be found or used?' },
  complication: { title: 'Complication', detail: 'What enters the moment?', pressure: 'How does it press the characters?', leverage: 'What choice or opening does it create?' },
  consequence: { title: 'Possible consequence', detail: 'What might become true?', pressure: 'What action would bring it about?', leverage: 'How might it be avoided or exploited?' },
  rumour: { title: 'Rumour', detail: 'What is being said?', pressure: 'Why does it matter now?', leverage: 'Who benefits if it is believed?' },
  treasure: { title: 'Treasure', detail: 'What is it?', pressure: 'What danger or cost follows it?', leverage: 'What can it make possible?' },
}
const discoveryCopy = {
  faction: { detail: 'What do they want?', tension: 'What stands against them?', detailPlaceholder: 'Control every route into the drowned town.', tensionPlaceholder: 'Their bargains bind them to the tide.' },
  location: { detail: 'What is here?', tension: 'What makes it dangerous?', detailPlaceholder: 'A chapel revealed beneath the cracked square.', tensionPlaceholder: 'Every spoken name wakes one of its bells.' },
  npc: { detail: 'What is their place in the world?', tension: 'What do they want?', detailPlaceholder: 'Keeper of the submerged archive.', tensionPlaceholder: 'For someone to return the name the sea took.' },
  hook: { detail: 'What choice or trouble appeared?', tension: '', detailPlaceholder: 'A second bell answers from beyond the town wall.', tensionPlaceholder: '' },
}

function draftFrom(context: SceneContext): SceneDraft {
  if (context.preparation) {
    const { title, framing, stakes, question, characterIds, locationIds, npcIds, clues, complications, sessionQuestions, revision } = context.preparation
    return { title, framing, stakes, question, characterIds, locationIds, npcIds, clues, complications, sessionQuestions, expectedRevision: revision }
  }
  const connectedLocations = [...new Set(context.characters.map((character) => character.locationId).filter((id): id is string => Boolean(id)))]
  const connectedNpcs = [...new Set(context.characters.map((character) => character.npcId).filter((id): id is string => Boolean(id)))]
  return {
    title: context.openingCrisis?.title ?? '',
    framing: context.openingCrisis?.situation ?? '',
    stakes: context.openingCrisis?.stakes ?? '',
    question: '',
    characterIds: context.characters.map((character) => character.id),
    locationIds: connectedLocations.length ? connectedLocations : context.locations[0] ? [context.locations[0].id!] : [],
    npcIds: connectedNpcs.length ? connectedNpcs : context.npcs[0] ? [context.npcs[0].id!] : [],
    clues: [''],
    complications: [''],
    sessionQuestions: [''],
    expectedRevision: null,
  }
}

export function SceneFolio({ session, suppliedContext, onContext, onOpenRoom, onClose }: {
  session: TableSession
  suppliedContext: SceneContext | null
  onContext: (context: SceneContext) => void
  onOpenRoom: (roomId: string) => void
  onClose: () => void
}) {
  const authorization = useMemo(() => ({ authorization: `Bearer ${session.player.token}` }), [session.player.token])
  const [context, setContext] = useState<SceneContext | null>(suppliedContext)
  const [draft, setDraft] = useState<SceneDraft | null>(suppliedContext ? draftFrom(suppliedContext) : null)
  const [outcome, setOutcome] = useState('')
  const [consequences, setConsequences] = useState<ConsequenceDraft[]>([])
  const [discoveries, setDiscoveries] = useState<DiscoveryDraft[]>([])
  const [pending, setPending] = useState('load')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [materialKind, setMaterialKind] = useState<InPlayMaterialKind>('npc')
  const [materialPrompt, setMaterialPrompt] = useState('')
  const [materialDraft, setMaterialDraft] = useState<InPlayMaterial | null>(null)
  const savedDraft = context?.preparation ? JSON.stringify({ ...context.preparation, revision: undefined, updatedAt: undefined, updatedByName: undefined }) : null
  const currentDraft = draft ? JSON.stringify({ ...draft, expectedRevision: undefined }) : null
  const hasUnsavedChanges = savedDraft !== currentDraft

  useEffect(() => {
    let active = true
    void api<SceneContext>('/api/campaign/scenes', { headers: authorization })
      .then((result) => { if (active) { setContext(result); setDraft(draftFrom(result)); onContext(result) } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'The scene folio could not be read.') })
      .finally(() => { if (active) setPending('') })
    return () => { active = false }
  }, [authorization, onContext])

  const establish = () => {
    if (!draft || hasUnsavedChanges || !context?.preparation) return
    setPending('start'); setError(''); setNotice('')
    void api<{ context: SceneContext; roomId: string }>('/api/campaign/scenes', { method: 'POST', headers: authorization })
      .then((result) => {
        setContext(result.context); onContext(result.context); setNotice('The threshold is in the transcript. Play has begun.'); onOpenRoom(result.roomId)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The scene could not be established.'))
      .finally(() => setPending(''))
  }

  const savePreparation = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setPending('save'); setError(''); setNotice('')
    void api<SceneContext>('/api/campaign/scene-preparation', { method: 'PUT', headers: authorization, body: JSON.stringify(draft) })
      .then((result) => { setContext(result); setDraft(draftFrom(result)); onContext(result); setNotice(`Session preparation saved as revision ${result.preparation?.revision ?? 0}.`) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The session preparation could not be saved.'))
      .finally(() => setPending(''))
  }

  const resolve = () => {
    if (!context?.activeScene) return
    setPending('resolve'); setError(''); setNotice('')
    void api<{ context: SceneContext; roomId: string }>(`/api/campaign/scenes/${context.activeScene.id}/resolve`, { method: 'POST', headers: authorization, body: JSON.stringify({ outcome, consequences, discoveries }) })
      .then((result) => {
        setContext(result.context); onContext(result.context); setDraft(draftFrom(result.context)); setOutcome(''); setConsequences([]); setDiscoveries([]); setNotice('The outcome and its changes are in the campaign ledger.'); onOpenRoom(result.roomId)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The scene could not be resolved.'))
      .finally(() => setPending(''))
  }

  const draftMaterial = () => {
    if (!context?.activeScene || !materialPrompt.trim()) return
    setPending('draft-material'); setError(''); setNotice('')
    void api<{ draft: InPlayMaterial }>(`/api/campaign/scenes/${context.activeScene.id}/materials/draft`, { method: 'POST', headers: authorization, body: JSON.stringify({ kind: materialKind, prompt: materialPrompt }) })
      .then(({ draft }) => setMaterialDraft(draft))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'No useful draft came back to the table.'))
      .finally(() => setPending(''))
  }

  const keepMaterial = () => {
    if (!context?.activeScene || !materialDraft) return
    setPending('keep-material'); setError(''); setNotice('')
    void api<{ context: SceneContext }>(`/api/campaign/scenes/${context.activeScene.id}/materials`, { method: 'POST', headers: authorization, body: JSON.stringify(materialDraft) })
      .then((result) => { setContext(result.context); onContext(result.context); setNotice(`${materialDraft.title} is now in the campaign.`); setMaterialDraft(null); setMaterialPrompt('') })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The draft could not enter the campaign.'))
      .finally(() => setPending(''))
  }

  const toggleCharacter = (id: string) => {
    if (!draft) return
    setDraft({ ...draft, characterIds: draft.characterIds.includes(id) ? draft.characterIds.filter((item) => item !== id) : [...draft.characterIds, id] })
  }
  const toggleWorldId = (field: 'locationIds' | 'npcIds', id: string) => {
    if (!draft) return
    setDraft({ ...draft, [field]: draft[field].includes(id) ? draft[field].filter((item) => item !== id) : [...draft[field], id] })
  }
  const updateList = (field: 'clues' | 'complications' | 'sessionQuestions', index: number, value: string) => draft && setDraft({ ...draft, [field]: draft[field].map((item, itemIndex) => itemIndex === index ? value : item) })
  const addListItem = (field: 'clues' | 'complications' | 'sessionQuestions') => draft && draft[field].length < 8 && setDraft({ ...draft, [field]: [...draft[field], ''] })
  const removeListItem = (field: 'clues' | 'complications' | 'sessionQuestions', index: number) => draft && draft[field].length > 1 && setDraft({ ...draft, [field]: draft[field].filter((_, itemIndex) => itemIndex !== index) })

  const updateConsequence = (index: number, values: Partial<ConsequenceDraft>) => setConsequences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item))
  const chooseConsequenceTarget = (index: number, entity: SceneContext['worldEntities'][number]) => updateConsequence(index, {
    entityId: entity.id,
    entityType: entity.type,
    state: Object.fromEntries(Object.entries(entity.state).filter(([key, value]) => !['pressure', 'sourceSceneId', 'updatedAt'].includes(key) && typeof value === 'string')) as Record<string, string>,
    pressure: entity.state.pressure,
  })
  const consequencesComplete = consequences.every((item) => item.entityType && item.entityId && Object.values(item.state).every((value) => value.trim()) && item.pressure.trim())
  const updateDiscovery = (index: number, values: Partial<DiscoveryDraft>) => setDiscoveries((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item))
  const discoveriesComplete = discoveries.every((item) => item.entityType && item.name.trim() && item.detail.trim() && (item.entityType === 'hook' || item.tension.trim()) && (item.entityType !== 'npc' || item.leverage.trim()))
  const draftComplete = Boolean(draft?.title.trim() && draft.framing.trim() && draft.stakes.trim() && draft.question.trim() && draft.characterIds.length && draft.locationIds.length && draft.npcIds.length && draft.clues.every((item) => item.trim()) && draft.complications.every((item) => item.trim()) && draft.sessionQuestions.every((item) => item.trim()))

  return <div className="drawer-layer drawer-layer--right" role="dialog" aria-modal="true" aria-labelledby="scene-folio-heading">
    <button className="drawer-scrim" onClick={onClose} aria-label="Dismiss scene folio" />
    <aside className="scene-folio">
      <div className="drawer-heading"><div><span id="scene-folio-heading">Scene at the table</span><small>{context?.activeScene ? 'In play now' : 'Cross from preparation into play'}</small></div><button className="icon-button" onClick={onClose} aria-label="Close scene folio"><X size={18} /></button></div>
      <div className="scene-folio__body">
        {error && <div className="folio-error" role="alert">{error}</div>}
        {notice && <div className="world-notice" role="status">{notice}</div>}
        {pending === 'load' ? <p className="folio-loading">Reading the table’s place in the story…</p> : !context?.openingCrisis ? <section className="scene-prerequisite"><CircleDot size={22} /><span className="eyebrow">The world comes first</span><h2>Establish the campaign opening</h2><p>A scene needs the crisis, pressure, and stakes kept in the World folio.</p></section> : !context.characters.length ? <section className="scene-prerequisite"><CircleDot size={22} /><span className="eyebrow">The party comes first</span><h2>Someone must take a seat</h2><p>Create at least one character before framing the opening scene.</p></section> : context.activeScene ? <section className="scene-active">
          <header><span className="eyebrow">Now in play</span><h2>{context.activeScene.title}</h2><p>{context.activeScene.framing}</p></header>
          <div className="scene-active__pressure"><div><span>If nobody acts</span><p>{context.activeScene.stakes}</p></div><div><span>The first choice</span><p>{context.activeScene.question}</p></div></div>
          <div className="scene-cast"><span>Present at the threshold</span><div>{context.activeScene.characters.map((character) => <span key={character.id}><strong>{character.name}</strong><small>{character.playerName}</small></span>)}</div></div>
          <section className="scene-improvisation"><div className="scene-improvisation__heading"><div><span className="eyebrow">When the table turns</span><h3>Create what play needs now</h3><p>Ask for one private draft. Rewrite it freely; nothing enters the campaign until you keep it.</p></div><Sparkles size={18} /></div>
            <div className="scene-improvisation__kinds">{materialKinds.map((kind) => <button type="button" key={kind} className={materialKind === kind ? 'is-chosen' : ''} aria-pressed={materialKind === kind} onClick={() => { setMaterialKind(kind); setMaterialDraft(null) }}>{kind}</button>)}</div>
            <label htmlFor="material-prompt">What does the table need?</label><div className="scene-improvisation__prompt"><textarea id="material-prompt" value={materialPrompt} onChange={(event) => setMaterialPrompt(event.target.value)} maxLength={500} placeholder="Someone who knows why the archive door opened…" /><button type="button" className="folio-button" onClick={draftMaterial} disabled={!materialPrompt.trim() || pending === 'draft-material'}>{pending === 'draft-material' ? 'Drafting…' : 'Draft one'}</button></div>
            {materialDraft && <article className="scene-material-draft"><div><span>Private {materialDraft.kind} draft</span><small>{materialDraft.generatorVersion}</small></div><label htmlFor="material-title">{materialCopy[materialDraft.kind].title}</label><input id="material-title" value={materialDraft.title} onChange={(event) => setMaterialDraft({ ...materialDraft, title: event.target.value })} maxLength={120} /><label htmlFor="material-detail">{materialCopy[materialDraft.kind].detail}</label><textarea id="material-detail" value={materialDraft.detail} onChange={(event) => setMaterialDraft({ ...materialDraft, detail: event.target.value })} maxLength={200} /><label htmlFor="material-pressure">{materialCopy[materialDraft.kind].pressure}</label><textarea id="material-pressure" value={materialDraft.pressure} onChange={(event) => setMaterialDraft({ ...materialDraft, pressure: event.target.value })} maxLength={280} /><label htmlFor="material-leverage">{materialCopy[materialDraft.kind].leverage}</label><textarea id="material-leverage" value={materialDraft.leverage} onChange={(event) => setMaterialDraft({ ...materialDraft, leverage: event.target.value })} maxLength={400} /><footer><span>{materialDraft.kind === 'consequence' ? 'Kept as a possible consequence, not a world change.' : materialDraft.kind === 'npc' || materialDraft.kind === 'place' ? 'This will join the World immediately.' : 'This will join the campaign as an actionable hook.'}</span><button type="button" className="primary-action" onClick={keepMaterial} disabled={!materialDraft.title.trim() || !materialDraft.detail.trim() || !materialDraft.pressure.trim() || !materialDraft.leverage.trim() || pending === 'keep-material'}>{pending === 'keep-material' ? 'Keeping…' : 'Keep in campaign'}</button></footer></article>}
            {context.inPlayMaterials.length > 0 && <div className="scene-material-kept"><span>Kept from this scene</span>{context.inPlayMaterials.map((material) => <article key={material.id}><small>{material.kind}</small><strong>{material.title}</strong><p>{material.detail}</p><blockquote>{material.pressure}</blockquote></article>)}</div>}
          </section>
          <section className="scene-active__preparation"><span className="eyebrow">Behind the screen</span><div className="scene-active__stage"><div><strong>Places in reach</strong>{context.activeScene.locations.map((location) => <p key={location.id}><b>{location.name}</b>{location.description}<small>{location.danger}</small></p>)}</div><div><strong>People in motion</strong>{context.activeScene.npcs.map((npc) => <p key={npc.id}><b>{npc.name}</b>{npc.role}<small>{npc.want}</small></p>)}</div></div><div className="scene-active__possibilities"><div><strong>Discoveries</strong>{context.activeScene.clues.map((item, index) => <p key={index}>{item}</p>)}</div><div><strong>Complications</strong>{context.activeScene.complications.map((item, index) => <p key={index}>{item}</p>)}</div><div><strong>Play to find out</strong>{context.activeScene.sessionQuestions.map((item, index) => <p key={index}>{item}</p>)}</div></div></section>
          <div className="scene-resolution"><span className="eyebrow">When the moment has changed</span><label htmlFor="scene-outcome">What is true because this scene happened?</label><textarea id="scene-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={2_000} placeholder="The bell cracked, but Iria’s brother answered from beneath the square…" />
            <div className="scene-fallout"><div className="scene-fallout__heading"><div><strong>World fallout</strong><span>Change the current truth of a person, place, faction, or hook.</span></div>{consequences.length < 3 && <button type="button" className="folio-button" onClick={() => setConsequences((items) => [...items, { entityType: '', entityId: '', state: {}, pressure: '' }])}><Plus size={14} />Record fallout</button>}</div>
              {consequences.map((consequence, index) => <article key={index}><div className="scene-fallout__leaf-heading"><span>Consequence {index + 1}</span><button type="button" className="icon-button" aria-label={`Remove consequence ${index + 1}`} onClick={() => setConsequences((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><div className="scene-fallout__targets">{context.worldEntities.map((entity) => <button type="button" key={`${entity.type}:${entity.id}`} className={consequence.entityId === entity.id && consequence.entityType === entity.type ? 'is-chosen' : ''} aria-pressed={consequence.entityId === entity.id && consequence.entityType === entity.type} disabled={consequences.some((item, itemIndex) => itemIndex !== index && item.entityId === entity.id && item.entityType === entity.type)} onClick={() => chooseConsequenceTarget(index, entity)}><small>{entity.type}</small><strong>{entity.name}</strong></button>)}</div>{consequence.entityType && <div className="scene-fallout__state">{(consequence.entityType === 'faction' || consequence.entityType === 'npc') && <><label htmlFor={`consequence-goal-${index}`}>Current goal</label><textarea id={`consequence-goal-${index}`} value={consequence.state.goal ?? ''} onChange={(event) => updateConsequence(index, { state: { ...consequence.state, goal: event.target.value } })} maxLength={500} /><label htmlFor={`consequence-relationship-${index}`}>Relationship to the party</label><textarea id={`consequence-relationship-${index}`} value={consequence.state.relationship ?? ''} onChange={(event) => updateConsequence(index, { state: { ...consequence.state, relationship: event.target.value } })} maxLength={500} /></>}{consequence.entityType === 'location' && <><label htmlFor={`consequence-ownership-${index}`}>Who controls or claims it?</label><textarea id={`consequence-ownership-${index}`} value={consequence.state.ownership ?? ''} onChange={(event) => updateConsequence(index, { state: { ...consequence.state, ownership: event.target.value } })} maxLength={500} /><label htmlFor={`consequence-danger-${index}`}>Current danger</label><textarea id={`consequence-danger-${index}`} value={consequence.state.danger ?? ''} onChange={(event) => updateConsequence(index, { state: { ...consequence.state, danger: event.target.value } })} maxLength={500} /></>}{consequence.entityType === 'hook' && <><label htmlFor={`consequence-situation-${index}`}>Current situation</label><textarea id={`consequence-situation-${index}`} value={consequence.state.situation ?? ''} onChange={(event) => updateConsequence(index, { state: { ...consequence.state, situation: event.target.value } })} maxLength={1_000} /><span className="scene-fallout__status-label">Is this still open?</span><div className="scene-fallout__status">{(['open', 'resolved'] as const).map((status) => <button type="button" key={status} className={consequence.state.status === status ? 'is-chosen' : ''} aria-pressed={consequence.state.status === status} onClick={() => updateConsequence(index, { state: { ...consequence.state, status } })}>{status}</button>)}</div></>}</div>}<label htmlFor={`consequence-pressure-${index}`}>What pressure remains?</label><textarea id={`consequence-pressure-${index}`} value={consequence.pressure} onChange={(event) => updateConsequence(index, { pressure: event.target.value })} maxLength={1_000} placeholder="The Salvagers will arrive before dawn to claim what surfaced." /></article>)}
            </div>
            <div className="scene-discoveries"><div className="scene-fallout__heading"><div><strong>What entered the story?</strong><span>Name people, places, forces, or trouble first encountered in this scene.</span></div>{discoveries.length < 3 && <button type="button" className="folio-button" onClick={() => setDiscoveries((items) => [...items, { entityType: '', name: '', detail: '', tension: '', leverage: '' }])}><Plus size={14} />Keep a discovery</button>}</div>
              {discoveries.map((discovery, index) => <article key={index}><div className="scene-fallout__leaf-heading"><span>Discovery {index + 1}</span><button type="button" className="icon-button" aria-label={`Remove discovery ${index + 1}`} onClick={() => setDiscoveries((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><div className="scene-discovery-types">{discoveryTypes.map((type) => <button type="button" key={type} className={discovery.entityType === type ? 'is-chosen' : ''} aria-pressed={discovery.entityType === type} onClick={() => updateDiscovery(index, { entityType: type, tension: type === 'hook' ? '' : discovery.tension, leverage: type === 'npc' ? discovery.leverage : '' })}>{type}</button>)}</div>{discovery.entityType && <><label htmlFor={`discovery-name-${index}`}>{discovery.entityType === 'hook' ? 'Hook' : 'Name'}</label><input id={`discovery-name-${index}`} value={discovery.name} onChange={(event) => updateDiscovery(index, { name: event.target.value })} maxLength={120} /><label htmlFor={`discovery-detail-${index}`}>{discoveryCopy[discovery.entityType].detail}</label><textarea id={`discovery-detail-${index}`} value={discovery.detail} onChange={(event) => updateDiscovery(index, { detail: event.target.value })} maxLength={discovery.entityType === 'location' ? 1_000 : 500} placeholder={discoveryCopy[discovery.entityType].detailPlaceholder} />{discovery.entityType !== 'hook' && <><label htmlFor={`discovery-tension-${index}`}>{discoveryCopy[discovery.entityType].tension}</label><textarea id={`discovery-tension-${index}`} value={discovery.tension} onChange={(event) => updateDiscovery(index, { tension: event.target.value })} maxLength={500} placeholder={discoveryCopy[discovery.entityType].tensionPlaceholder} /></>}{discovery.entityType === 'npc' && <><label htmlFor={`discovery-leverage-${index}`}>What can they offer or threaten?</label><textarea id={`discovery-leverage-${index}`} value={discovery.leverage} onChange={(event) => updateDiscovery(index, { leverage: event.target.value })} maxLength={500} placeholder="A dry road through the drowned streets." /></>}</>}</article>)}
            </div>
            <button className="primary-action" onClick={resolve} disabled={!outcome.trim() || !consequencesComplete || !discoveriesComplete || pending === 'resolve'}>{pending === 'resolve' ? 'Keeping the outcome…' : 'Resolve this scene'}</button></div>
        </section> : draft && <form className="scene-draft" onSubmit={savePreparation}>
          <header><span className="eyebrow">First-session folio</span><h2>Prepare pressure, not an outcome</h2><p>Gather the people, place, discoveries, and trouble the opening needs. Everything remains editable until you cross into play.</p></header>
          {context.worldConsequences.length > 0 && <section className="scene-moving-world"><div><span className="eyebrow">Pressure still moving</span><p>These consequences remain true until play changes them again.</p></div>{context.worldConsequences.map((consequence) => <article key={consequence.id}><small>{consequence.entityType} · from {consequence.sourceSceneTitle}</small><strong>{consequence.entityName}</strong><p>{consequence.afterState}</p><span>{consequence.pressure}</span><button type="button" className="folio-button" onClick={() => setDraft({ ...draft, stakes: draft.stakes.trim() ? `${draft.stakes.trim()}\n\n${consequence.entityName}: ${consequence.pressure}` : consequence.pressure })}>Carry into the stakes</button></article>)}</section>}
          <label htmlFor="scene-title">The moment</label><input id="scene-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={120} />
          <label htmlFor="scene-framing">What the characters see happening</label><textarea id="scene-framing" value={draft.framing} onChange={(event) => setDraft({ ...draft, framing: event.target.value })} maxLength={2_000} />
          <label htmlFor="scene-stakes">What changes if nobody acts</label><textarea id="scene-stakes" value={draft.stakes} onChange={(event) => setDraft({ ...draft, stakes: event.target.value })} maxLength={1_000} />
          <label htmlFor="scene-question">What demands the first choice?</label><textarea id="scene-question" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} maxLength={500} placeholder="The bell rope pulls taut in Iria’s hand. Who cuts it—and who stops them?" />
          <section className="scene-preparation-group"><div className="scene-preparation-heading"><span className="eyebrow">The stage</span><p>Choose the places and people directly involved in this opening.</p></div>
            <fieldset className="scene-world-choices"><legend>Locations in reach</legend><div>{context.locations.map((location) => <button type="button" key={location.id} className={draft.locationIds.includes(location.id!) ? 'is-present' : ''} aria-pressed={draft.locationIds.includes(location.id!)} onClick={() => toggleWorldId('locationIds', location.id!)}><strong>{location.name}</strong><span>{location.description}</span><small>{location.danger}</small></button>)}</div></fieldset>
            <fieldset className="scene-world-choices"><legend>NPCs in motion</legend><div>{context.npcs.map((npc) => <button type="button" key={npc.id} className={draft.npcIds.includes(npc.id!) ? 'is-present' : ''} aria-pressed={draft.npcIds.includes(npc.id!)} onClick={() => toggleWorldId('npcIds', npc.id!)}><strong>{npc.name}</strong><span>{npc.role}</span><small>{npc.want}</small></button>)}</div></fieldset>
          </section>
          <section className="scene-preparation-group"><div className="scene-preparation-heading"><span className="eyebrow">Prepared possibilities</span><p>Offer things the characters can discover and pressures that may enter. None dictate what happens.</p></div>
            {([['clues', 'Clues or discoveries', 'What can become known?', 'The bell rope was cut once before, then carefully spliced.'], ['complications', 'Likely complications', 'What trouble may enter?', 'The Tidebound arrive asking the party to let the town drown.'], ['sessionQuestions', 'Questions for the session', 'What are you playing to find out?', 'Who rang the bell before the town returned?']] as const).map(([field, heading, label, placeholder]) => <div className="scene-preparation-list" key={field}><div><strong>{heading}</strong><button type="button" className="folio-button" onClick={() => addListItem(field)} disabled={draft[field].length >= 8}><Plus size={14} />Add</button></div>{draft[field].map((item, index) => <label key={index}><span>{label}</span><span className="scene-preparation-list__field"><textarea value={item} onChange={(event) => updateList(field, index, event.target.value)} maxLength={500} placeholder={placeholder} aria-label={`${heading} ${index + 1}`} /><button type="button" className="icon-button" onClick={() => removeListItem(field, index)} disabled={draft[field].length === 1} aria-label={`Remove ${heading.toLowerCase()} ${index + 1}`}><Trash2 size={14} /></button></span></label>)}</div>)}
          </section>
          <fieldset className="scene-character-choices"><legend>Who is present?</legend><div>{context.characters.map((character) => <button type="button" key={character.id} className={draft.characterIds.includes(character.id) ? 'is-present' : ''} aria-pressed={draft.characterIds.includes(character.id)} onClick={() => toggleCharacter(character.id)}><strong>{character.name}</strong><span>{character.playerName}</span><small>{character.concept}</small></button>)}</div></fieldset>
          <footer><div><strong>{hasUnsavedChanges ? 'Preparation has changes' : `Preparation revision ${context.preparation?.revision ?? 0} is kept`}</strong><span>Beginning play snapshots this folio into the campaign’s transcript.</span></div><button type="submit" className="folio-button" disabled={!draftComplete || !hasUnsavedChanges || pending === 'save'}>{pending === 'save' ? 'Keeping preparation…' : context.preparation ? 'Save revision' : 'Save preparation'}</button><button type="button" className="primary-action" onClick={establish} disabled={!draftComplete || hasUnsavedChanges || !context.preparation || pending === 'start'}>{pending === 'start' ? 'Opening the scene…' : 'Begin play'}</button></footer>
        </form>}
        {context && context.scenes.filter((scene) => scene.status === 'resolved').length > 0 && <section className="scene-past"><span>Earlier thresholds</span>{context.scenes.filter((scene) => scene.status === 'resolved').map((scene) => <article key={scene.id}><strong>{scene.title}</strong><p>{scene.outcome}</p><small>Resolved by {scene.resolvedByName ?? 'a GM'}</small></article>)}</section>}
      </div>
    </aside>
  </div>
}
