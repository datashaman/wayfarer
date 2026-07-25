import { CircleDot, Plus, Trash2, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { SceneContext, TableSession } from './types/protocol'

type SceneDraft = { title: string; framing: string; stakes: string; question: string; characterIds: string[] }
type ConsequenceDraft = { entityType: 'faction' | 'location' | 'npc' | 'hook' | ''; entityId: string; afterState: string; pressure: string }

function draftFrom(context: SceneContext): SceneDraft {
  return {
    title: context.openingCrisis?.title ?? '',
    framing: context.openingCrisis?.situation ?? '',
    stakes: context.openingCrisis?.stakes ?? '',
    question: '',
    characterIds: context.characters.map((character) => character.id),
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
  const [pending, setPending] = useState('load')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void api<SceneContext>('/api/campaign/scenes', { headers: authorization })
      .then((result) => { if (active) { setContext(result); setDraft(draftFrom(result)); onContext(result) } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'The scene folio could not be read.') })
      .finally(() => { if (active) setPending('') })
    return () => { active = false }
  }, [authorization, onContext])

  const establish = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setPending('start'); setError(''); setNotice('')
    void api<{ context: SceneContext; roomId: string }>('/api/campaign/scenes', { method: 'POST', headers: authorization, body: JSON.stringify(draft) })
      .then((result) => {
        setContext(result.context); onContext(result.context); setNotice('The threshold is in the transcript. Play has begun.'); onOpenRoom(result.roomId)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The scene could not be established.'))
      .finally(() => setPending(''))
  }

  const resolve = () => {
    if (!context?.activeScene) return
    setPending('resolve'); setError(''); setNotice('')
    void api<{ context: SceneContext; roomId: string }>(`/api/campaign/scenes/${context.activeScene.id}/resolve`, { method: 'POST', headers: authorization, body: JSON.stringify({ outcome, consequences }) })
      .then((result) => {
        setContext(result.context); onContext(result.context); setDraft(draftFrom(result.context)); setOutcome(''); setConsequences([]); setNotice('The outcome and its fallout are in the campaign ledger.'); onOpenRoom(result.roomId)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The scene could not be resolved.'))
      .finally(() => setPending(''))
  }

  const toggleCharacter = (id: string) => {
    if (!draft) return
    setDraft({ ...draft, characterIds: draft.characterIds.includes(id) ? draft.characterIds.filter((item) => item !== id) : [...draft.characterIds, id] })
  }

  const updateConsequence = (index: number, values: Partial<ConsequenceDraft>) => setConsequences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item))
  const consequencesComplete = consequences.every((item) => item.entityType && item.entityId && item.afterState.trim() && item.pressure.trim())

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
          <div className="scene-resolution"><span className="eyebrow">When the moment has changed</span><label htmlFor="scene-outcome">What is true because this scene happened?</label><textarea id="scene-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={2_000} placeholder="The bell cracked, but Iria’s brother answered from beneath the square…" />
            <div className="scene-fallout"><div className="scene-fallout__heading"><div><strong>World fallout</strong><span>Keep concrete changes to people, places, factions, or hooks.</span></div>{consequences.length < 3 && <button type="button" className="folio-button" onClick={() => setConsequences((items) => [...items, { entityType: '', entityId: '', afterState: '', pressure: '' }])}><Plus size={14} />Record fallout</button>}</div>
              {consequences.map((consequence, index) => <article key={index}><div className="scene-fallout__leaf-heading"><span>Consequence {index + 1}</span><button type="button" className="icon-button" aria-label={`Remove consequence ${index + 1}`} onClick={() => setConsequences((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><div className="scene-fallout__targets">{context.worldEntities.map((entity) => <button type="button" key={`${entity.type}:${entity.id}`} className={consequence.entityId === entity.id && consequence.entityType === entity.type ? 'is-chosen' : ''} aria-pressed={consequence.entityId === entity.id && consequence.entityType === entity.type} disabled={consequences.some((item, itemIndex) => itemIndex !== index && item.entityId === entity.id && item.entityType === entity.type)} onClick={() => updateConsequence(index, { entityId: entity.id, entityType: entity.type })}><small>{entity.type}</small><strong>{entity.name}</strong></button>)}</div><label htmlFor={`consequence-after-${index}`}>What is true now?</label><textarea id={`consequence-after-${index}`} value={consequence.afterState} onChange={(event) => updateConsequence(index, { afterState: event.target.value })} maxLength={1_000} placeholder="The square lies open to the drowned archive below." /><label htmlFor={`consequence-pressure-${index}`}>What pressure remains?</label><textarea id={`consequence-pressure-${index}`} value={consequence.pressure} onChange={(event) => updateConsequence(index, { pressure: event.target.value })} maxLength={1_000} placeholder="The Salvagers will arrive before dawn to claim what surfaced." /></article>)}
            </div>
            <button className="primary-action" onClick={resolve} disabled={!outcome.trim() || !consequencesComplete || pending === 'resolve'}>{pending === 'resolve' ? 'Keeping the outcome…' : 'Resolve this scene'}</button></div>
        </section> : draft && <form className="scene-draft" onSubmit={establish}>
          <header><span className="eyebrow">The opening threshold</span><h2>Put the crisis in front of the characters</h2><p>Frame what is happening now, not what must happen next. The transcript will keep this exact starting point.</p></header>
          {context.worldConsequences.length > 0 && <section className="scene-moving-world"><div><span className="eyebrow">Pressure still moving</span><p>These consequences remain true until play changes them again.</p></div>{context.worldConsequences.map((consequence) => <article key={consequence.id}><small>{consequence.entityType} · from {consequence.sourceSceneTitle}</small><strong>{consequence.entityName}</strong><p>{consequence.afterState}</p><span>{consequence.pressure}</span><button type="button" className="folio-button" onClick={() => setDraft({ ...draft, stakes: draft.stakes.trim() ? `${draft.stakes.trim()}\n\n${consequence.entityName}: ${consequence.pressure}` : consequence.pressure })}>Carry into the stakes</button></article>)}</section>}
          <label htmlFor="scene-title">The moment</label><input id="scene-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={120} />
          <label htmlFor="scene-framing">What the characters see happening</label><textarea id="scene-framing" value={draft.framing} onChange={(event) => setDraft({ ...draft, framing: event.target.value })} maxLength={2_000} />
          <label htmlFor="scene-stakes">What changes if nobody acts</label><textarea id="scene-stakes" value={draft.stakes} onChange={(event) => setDraft({ ...draft, stakes: event.target.value })} maxLength={1_000} />
          <label htmlFor="scene-question">What demands the first choice?</label><textarea id="scene-question" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} maxLength={500} placeholder="The bell rope pulls taut in Iria’s hand. Who cuts it—and who stops them?" />
          <fieldset className="scene-character-choices"><legend>Who is present?</legend><div>{context.characters.map((character) => <button type="button" key={character.id} className={draft.characterIds.includes(character.id) ? 'is-present' : ''} aria-pressed={draft.characterIds.includes(character.id)} onClick={() => toggleCharacter(character.id)}><strong>{character.name}</strong><span>{character.playerName}</span><small>{character.concept}</small></button>)}</div></fieldset>
          <footer><div><strong>One threshold marker</strong><span>Every selected character and the exact framing will be visible to the table.</span></div><button className="primary-action" disabled={!draft.title.trim() || !draft.framing.trim() || !draft.stakes.trim() || !draft.question.trim() || !draft.characterIds.length || pending === 'start'}>{pending === 'start' ? 'Opening the scene…' : 'Begin play'}</button></footer>
        </form>}
        {context && context.scenes.filter((scene) => scene.status === 'resolved').length > 0 && <section className="scene-past"><span>Earlier thresholds</span>{context.scenes.filter((scene) => scene.status === 'resolved').map((scene) => <article key={scene.id}><strong>{scene.title}</strong><p>{scene.outcome}</p><small>Resolved by {scene.resolvedByName ?? 'a GM'}</small></article>)}</section>}
      </div>
    </aside>
  </div>
}
