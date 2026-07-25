import { BookOpenText, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { CampaignWorld, TableSession } from './types/protocol'

function blankWorld(premise: string): CampaignWorld {
  return {
    title: '', premise, pitch: '',
    truths: Array.from({ length: 3 }, () => ({ text: '' })),
    factions: Array.from({ length: 2 }, () => ({ name: '', goal: '', opposition: '' })),
    locations: Array.from({ length: 3 }, () => ({ name: '', description: '', danger: '' })),
    npcs: Array.from({ length: 5 }, () => ({ name: '', role: '', want: '', leverage: '' })),
    hooks: Array.from({ length: 4 }, () => ({ title: '', situation: '' })),
    openingCrisis: { title: '', situation: '', stakes: '' },
    generatorVersion: 'manual:campaign-seed-v1',
    consequences: [],
    discoveries: [],
  }
}

function complete(world: CampaignWorld) {
  const values = [
    world.title, world.premise, world.pitch,
    ...world.truths.flatMap((item) => [item.text]),
    ...world.factions.flatMap((item) => [item.name, item.goal, item.opposition]),
    ...world.locations.flatMap((item) => [item.name, item.description, item.danger]),
    ...world.npcs.flatMap((item) => [item.name, item.role, item.want, item.leverage]),
    ...world.hooks.flatMap((item) => [item.title, item.situation]),
    world.openingCrisis.title, world.openingCrisis.situation, world.openingCrisis.stakes,
  ]
  return values.every((value) => value.trim())
}

export function CampaignWorldFolio({ session, onClose }: { session: TableSession; onClose: () => void }) {
  const authorization = useMemo(() => ({ authorization: `Bearer ${session.player.token}` }), [session.player.token])
  const [world, setWorld] = useState<CampaignWorld | null>(null)
  const [draft, setDraft] = useState<CampaignWorld | null>(null)
  const [premise, setPremise] = useState('')
  const [pending, setPending] = useState('load')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api<{ world: CampaignWorld | null }>('/api/campaign/world', { headers: authorization })
      .then((result) => {
        if (!active) return
        setWorld(result.world)
        setDraft(result.world)
        setPremise(result.world?.premise ?? '')
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'The campaign opening could not be read.') })
      .finally(() => { if (active) setPending('') })
    return () => { active = false }
  }, [authorization])

  const generate = () => {
    setPending('generate'); setError(''); setNotice('')
    void api<{ draft: CampaignWorld }>('/api/campaign/world/draft', { method: 'POST', headers: authorization, body: JSON.stringify({ premise }) })
      .then((result) => setDraft(result.draft))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'A playable opening could not be drafted.'))
      .finally(() => setPending(''))
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setPending('save'); setError(''); setNotice('')
    const method = world ? 'PUT' : 'POST'
    const body = world ? { ...draft, expectedRevision: world.revision } : draft
    void api<{ world: CampaignWorld }>('/api/campaign/world', { method, headers: authorization, body: JSON.stringify(body) })
      .then((result) => {
        setWorld(result.world)
        setDraft(result.world)
        setPremise(result.world.premise)
        setNotice(world ? `Campaign foundation saved as revision ${result.world.revision}.` : 'Campaign foundation established. The table now has somewhere to begin.')
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The campaign opening could not be saved.'))
      .finally(() => setPending(''))
  }

  const updateList = <T extends keyof Pick<CampaignWorld, 'truths' | 'factions' | 'locations' | 'npcs' | 'hooks'>>(collection: T, index: number, values: Partial<CampaignWorld[T][number]>) => {
    if (!draft) return
    setDraft({ ...draft, [collection]: draft[collection].map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item) })
  }

  return <div className="drawer-layer drawer-layer--right" role="dialog" aria-modal="true" aria-labelledby="world-folio-heading">
    <button className="drawer-scrim" onClick={onClose} aria-label="Dismiss campaign opening" />
    <aside className="world-folio">
      <div className="drawer-heading"><div><span id="world-folio-heading">Campaign opening</span><small>{world ? `Foundation · revision ${world.revision}` : 'Make something playable'}</small></div><button className="icon-button" onClick={onClose} aria-label="Close campaign opening"><X size={18} /></button></div>
      <div className="world-folio__body">
        {error && <div className="folio-error" role="alert">{error}</div>}
        {notice && <div className="world-notice" role="status">{notice}</div>}
        {pending === 'load' ? <p className="folio-loading">Opening the campaign folio…</p> : !draft ? <section className="world-begin" aria-labelledby="world-begin-heading">
          <span className="eyebrow">First spark</span>
          <h2 id="world-begin-heading">Give the table a situation it can change</h2>
          <p>Bring one rough idea. Wayfarer will offer pressure, people, places, and an opening crisis—not a plotted story. Nothing becomes campaign material until you edit and save it.</p>
          <label htmlFor="campaign-premise">What is this campaign about?</label>
          <textarea id="campaign-premise" value={premise} onChange={(event) => setPremise(event.target.value)} maxLength={1_000} placeholder="For seven nights, a drowned town returns beneath a moonless sky…" autoFocus />
          <div className="world-begin__actions"><button className="primary-action" onClick={generate} disabled={!premise.trim() || pending === 'generate'}><BookOpenText size={15} />{pending === 'generate' ? 'Finding the pressure…' : 'Draft a playable opening'}</button><button className="folio-button" onClick={() => setDraft(blankWorld(premise))} disabled={!premise.trim()}>Start with a blank folio</button></div>
        </section> : <form className="world-spread" onSubmit={save}>
          <header className="world-spread__lead">
            <span className="eyebrow">The invitation</span>
            <label htmlFor="world-title">Campaign title</label><input id="world-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={120} />
            <label htmlFor="world-premise">Starting premise</label><textarea id="world-premise" value={draft.premise} onChange={(event) => setDraft({ ...draft, premise: event.target.value })} maxLength={1_000} />
            <label htmlFor="world-pitch">What the players are stepping into</label><textarea id="world-pitch" value={draft.pitch} onChange={(event) => setDraft({ ...draft, pitch: event.target.value })} maxLength={1_000} />
            <small>{draft.generatorVersion === 'manual:campaign-seed-v1' ? 'Begun by hand' : `Private draft · ${draft.generatorVersion}`}</small>
          </header>

          {(draft.consequences ?? []).length > 0 && <section className="world-spread__section world-aftermath" aria-labelledby="world-aftermath-heading"><div><span>The world remembers play</span><h2 id="world-aftermath-heading">World in motion</h2></div><ol>{(draft.consequences ?? []).map((consequence) => <li key={consequence.id} className={consequence.status === 'active' ? 'is-active' : ''}><div className="world-aftermath__provenance"><span>{consequence.entityType}</span><small>{consequence.status === 'active' ? `Changed in ${consequence.sourceSceneTitle}` : `Changed again in ${consequence.resolvedSceneTitle}`}</small></div><h3>{consequence.entityName}</h3><div className="world-aftermath__change"><p><small>Before</small>{consequence.beforeState}</p><span aria-hidden="true">→</span><p><small>Now</small>{consequence.afterState}</p></div><blockquote>{consequence.pressure}</blockquote>{consequence.status === 'resolved' && consequence.resolution && <p className="world-aftermath__resolution">Later outcome: {consequence.resolution}</p>}</li>)}</ol></section>}

          {(draft.discoveries ?? []).length > 0 && <section className="world-spread__section world-discoveries" aria-labelledby="world-discoveries-heading"><div><span>First encountered at the table</span><h2 id="world-discoveries-heading">Entered through play</h2></div><ol>{(draft.discoveries ?? []).map((discovery) => <li key={discovery.id}><div className="world-aftermath__provenance"><span>{discovery.materialKind ?? discovery.entityType}</span><small>First entered the ledger in “{discovery.sourceSceneTitle}”</small></div><h3>{discovery.name}</h3><dl>{Object.entries(discovery.snapshot).filter(([field]) => field !== 'name' && field !== 'title').map(([field, value]) => <div key={field}><dt>{({ goal: 'What they want', opposition: 'What stands against them', description: 'What is here', danger: 'Danger', role: 'Place in the world', want: 'What they want', leverage: 'Offer or threat', situation: 'Choice or trouble' } as Record<string, string>)[field] ?? field}</dt><dd>{value}</dd></div>)}</dl></li>)}</ol></section>}

          <section className="world-spread__section world-spread__truths" aria-labelledby="world-truths-heading"><div><span>What cannot be ignored</span><h2 id="world-truths-heading">Three truths</h2></div><ol>{draft.truths.map((truth, index) => <li key={truth.id ?? index}><label htmlFor={`world-truth-${index}`}>Truth {index + 1}</label><textarea id={`world-truth-${index}`} value={truth.text} onChange={(event) => updateList('truths', index, { text: event.target.value })} maxLength={500} /></li>)}</ol></section>

          <section className="world-spread__section" aria-labelledby="world-factions-heading"><div><span>Forces in collision</span><h2 id="world-factions-heading">Factions</h2></div><ol className="world-spread__grid world-spread__grid--two">{draft.factions.map((faction, index) => <li key={faction.id ?? index}><label htmlFor={`world-faction-name-${index}`}>Name</label><input id={`world-faction-name-${index}`} value={faction.name} onChange={(event) => updateList('factions', index, { name: event.target.value })} maxLength={120} /><label htmlFor={`world-faction-goal-${index}`}>What they want</label><textarea id={`world-faction-goal-${index}`} value={faction.goal} onChange={(event) => updateList('factions', index, { goal: event.target.value })} maxLength={500} /><label htmlFor={`world-faction-opposition-${index}`}>What stands against them</label><textarea id={`world-faction-opposition-${index}`} value={faction.opposition} onChange={(event) => updateList('factions', index, { opposition: event.target.value })} maxLength={500} /></li>)}</ol></section>

          <section className="world-spread__section" aria-labelledby="world-places-heading"><div><span>Places worth entering</span><h2 id="world-places-heading">Locations</h2></div><ol className="world-spread__grid world-spread__grid--three">{draft.locations.map((location, index) => <li key={location.id ?? index}><label htmlFor={`world-location-name-${index}`}>Name</label><input id={`world-location-name-${index}`} value={location.name} onChange={(event) => updateList('locations', index, { name: event.target.value })} maxLength={120} /><label htmlFor={`world-location-description-${index}`}>What is here</label><textarea id={`world-location-description-${index}`} value={location.description} onChange={(event) => updateList('locations', index, { description: event.target.value })} maxLength={1_000} /><label htmlFor={`world-location-danger-${index}`}>Danger</label><textarea id={`world-location-danger-${index}`} value={location.danger} onChange={(event) => updateList('locations', index, { danger: event.target.value })} maxLength={500} /></li>)}</ol></section>

          <section className="world-spread__section" aria-labelledby="world-people-heading"><div><span>People with leverage</span><h2 id="world-people-heading">Cast</h2></div><ol className="world-spread__grid world-spread__grid--two">{draft.npcs.map((npc, index) => <li key={npc.id ?? index}><label htmlFor={`world-npc-name-${index}`}>Name</label><input id={`world-npc-name-${index}`} value={npc.name} onChange={(event) => updateList('npcs', index, { name: event.target.value })} maxLength={120} /><label htmlFor={`world-npc-role-${index}`}>Place in the world</label><input id={`world-npc-role-${index}`} value={npc.role} onChange={(event) => updateList('npcs', index, { role: event.target.value })} maxLength={200} /><label htmlFor={`world-npc-want-${index}`}>What they want</label><textarea id={`world-npc-want-${index}`} value={npc.want} onChange={(event) => updateList('npcs', index, { want: event.target.value })} maxLength={500} /><label htmlFor={`world-npc-leverage-${index}`}>What they can offer or threaten</label><textarea id={`world-npc-leverage-${index}`} value={npc.leverage} onChange={(event) => updateList('npcs', index, { leverage: event.target.value })} maxLength={500} /></li>)}</ol></section>

          <section className="world-spread__section" aria-labelledby="world-hooks-heading"><div><span>Reasons to act</span><h2 id="world-hooks-heading">Hooks</h2></div><ol className="world-spread__grid world-spread__grid--two">{draft.hooks.map((hook, index) => <li key={hook.id ?? index}><label htmlFor={`world-hook-title-${index}`}>Hook</label><input id={`world-hook-title-${index}`} value={hook.title} onChange={(event) => updateList('hooks', index, { title: event.target.value })} maxLength={120} /><label htmlFor={`world-hook-situation-${index}`}>Choice or trouble</label><textarea id={`world-hook-situation-${index}`} value={hook.situation} onChange={(event) => updateList('hooks', index, { situation: event.target.value })} maxLength={500} /></li>)}</ol></section>

          <section className="world-spread__section world-crisis" aria-labelledby="world-crisis-heading"><div><span>Begin in motion</span><h2 id="world-crisis-heading">Opening crisis</h2></div><label htmlFor="world-crisis-title">The moment</label><input id="world-crisis-title" value={draft.openingCrisis.title} onChange={(event) => setDraft({ ...draft, openingCrisis: { ...draft.openingCrisis, title: event.target.value } })} maxLength={120} /><label htmlFor="world-crisis-situation">What is happening now</label><textarea id="world-crisis-situation" value={draft.openingCrisis.situation} onChange={(event) => setDraft({ ...draft, openingCrisis: { ...draft.openingCrisis, situation: event.target.value } })} maxLength={1_200} /><label htmlFor="world-crisis-stakes">What changes if nobody acts</label><textarea id="world-crisis-stakes" value={draft.openingCrisis.stakes} onChange={(event) => setDraft({ ...draft, openingCrisis: { ...draft.openingCrisis, stakes: event.target.value } })} maxLength={800} /></section>

          <footer className="world-spread__actions"><div><strong>{world ? `Revision ${world.revision}` : 'Unsaved campaign material'}</strong><span>{world ? `Last kept by ${world.updatedByName ?? 'a GM'}` : 'Review every line before establishing it.'}</span></div><button className="primary-action" disabled={!complete(draft) || pending === 'save'}>{pending === 'save' ? 'Keeping the foundation…' : world ? 'Save campaign revision' : 'Establish campaign foundation'}</button>{!world && <button type="button" className="folio-button" onClick={() => setDraft(null)}>Discard draft</button>}</footer>
        </form>}
      </div>
    </aside>
  </div>
}
