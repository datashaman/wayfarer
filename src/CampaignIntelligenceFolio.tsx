import { Check, Plus, X } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from './lib/api'
import type { CampaignIntelligenceOverview, CampaignSession, CanonEntry, FactionClock, HouseRule, SpotlightReport, TableSession } from './types/protocol'

const blankRule = { title: '', sourceRule: '', interpretation: '', ruling: '', reason: '' }
const blankClock = { name: '', goal: '', progress: 0, segments: 6 }

export function CampaignIntelligenceFolio({ session, onClose, onUseDraft }: { session: TableSession; onClose: () => void; onUseDraft: (draft: string) => void }) {
  const authorization = { authorization: `Bearer ${session.player.token}` }
  const isGm = session.player.knowledgeRole === 'gm'
  const [overview, setOverview] = useState<CampaignIntelligenceOverview | null>(null)
  const [sessions, setSessions] = useState<CampaignSession[]>([])
  const [rules, setRules] = useState<HouseRule[]>([])
  const [consent, setConsent] = useState(false)
  const [question, setQuestion] = useState('')
  const [knowledge, setKnowledge] = useState<{ answer: string; citations: CanonEntry[] } | null>(null)
  const [intent, setIntent] = useState('')
  const [drafts, setDrafts] = useState<string[]>([])
  const [ruleDraft, setRuleDraft] = useState(blankRule)
  const [editingRule, setEditingRule] = useState<HouseRule | null>(null)
  const [clockDraft, setClockDraft] = useState(blankClock)
  const [selectedSession, setSelectedSession] = useState('')
  const [spotlight, setSpotlight] = useState<SpotlightReport | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    const [{ rules: nextRules }, { sessions: nextSessions }, consentResult] = await Promise.all([
      api<{ rules: HouseRule[] }>('/api/campaign/intelligence/rules', { headers: authorization }),
      api<{ sessions: CampaignSession[] }>('/api/campaign/sessions', { headers: authorization }),
      api<{ consent: { enabled: boolean } }>('/api/campaign/intelligence/spotlight/consent', { headers: authorization }),
    ])
    setRules(nextRules)
    setSessions(nextSessions)
    setSelectedSession((current) => current || nextSessions.find((item) => item.status === 'closed')?.id || '')
    setConsent(consentResult.consent.enabled)
    if (isGm) setOverview(await api<CampaignIntelligenceOverview>('/api/campaign/intelligence', { headers: authorization }))
  }

  useEffect(() => {
    let active = true
    const headers = { authorization: `Bearer ${session.player.token}` }
    Promise.all([
      api<{ rules: HouseRule[] }>('/api/campaign/intelligence/rules', { headers }),
      api<{ sessions: CampaignSession[] }>('/api/campaign/sessions', { headers }),
      api<{ consent: { enabled: boolean } }>('/api/campaign/intelligence/spotlight/consent', { headers }),
      isGm ? api<CampaignIntelligenceOverview>('/api/campaign/intelligence', { headers }) : Promise.resolve(null),
    ]).then(([rulesResult, sessionsResult, consentResult, overviewResult]) => {
      if (!active) return
      setRules(rulesResult.rules)
      setSessions(sessionsResult.sessions)
      setSelectedSession(sessionsResult.sessions.find((item) => item.status === 'closed')?.id || '')
      setConsent(consentResult.consent.enabled)
      if (overviewResult) setOverview(overviewResult)
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Campaign intelligence could not be opened.') })
    return () => { active = false }
  }, [isGm, session.player.token])

  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request could not be completed.') } finally { setPending('') }
  }

  const askKnowledge = (event: FormEvent) => {
    event.preventDefault()
    void run('knowledge', async () => {
      setKnowledge(await api('/api/campaign/intelligence/knowledge', { method: 'POST', headers: authorization, body: JSON.stringify({ question }) }))
    })
  }

  const draftIntent = (event: FormEvent) => {
    event.preventDefault()
    void run('intent', async () => {
      const result = await api<{ drafts: string[] }>('/api/campaign/intelligence/intent', { method: 'POST', headers: authorization, body: JSON.stringify({ intent }) })
      setDrafts(result.drafts)
    })
  }

  const toggleConsent = () => void run('consent', async () => {
    const result = await api<{ consent: { enabled: boolean } }>('/api/campaign/intelligence/spotlight/consent', { method: 'PUT', headers: authorization, body: JSON.stringify({ enabled: !consent }) })
    setConsent(result.consent.enabled)
    if (isGm) await refresh()
  })

  const savePreparation = () => overview && void run('settings', async () => {
    setOverview(await api<CampaignIntelligenceOverview>('/api/campaign/intelligence/settings', { method: 'PUT', headers: authorization, body: JSON.stringify(overview.settings) }))
  })

  const prepareSession = () => void run('prepare', async () => {
    await api('/api/campaign/intelligence/preparation', { method: 'POST', headers: authorization, body: JSON.stringify({ sessionId: selectedSession }) })
    await refresh()
  })

  const saveRule = (event: FormEvent) => {
    event.preventDefault()
    void run('rule', async () => {
      if (editingRule) {
        await api(`/api/campaign/intelligence/rules/${editingRule.id}`, { method: 'PATCH', headers: authorization, body: JSON.stringify({ ...ruleDraft, status: editingRule.status, revision: editingRule.revision }) })
      } else {
        await api('/api/campaign/intelligence/rules', { method: 'POST', headers: authorization, body: JSON.stringify(ruleDraft) })
      }
      setEditingRule(null); setRuleDraft(blankRule); await refresh()
    })
  }

  const editRule = (rule: HouseRule) => {
    setEditingRule(rule)
    setRuleDraft({ title: rule.title, sourceRule: rule.sourceRule, interpretation: rule.interpretation, ruling: rule.ruling, reason: '' })
  }

  const retireRule = (rule: HouseRule) => void run(`retire-${rule.id}`, async () => {
    await api(`/api/campaign/intelligence/rules/${rule.id}`, { method: 'PATCH', headers: authorization, body: JSON.stringify({ ...rule, status: 'retired', reason: 'Retired by the table.', revision: rule.revision }) })
    await refresh()
  })

  const createClock = (event: FormEvent) => {
    event.preventDefault()
    void run('clock', async () => {
      await api('/api/campaign/intelligence/factions', { method: 'POST', headers: authorization, body: JSON.stringify(clockDraft) })
      setClockDraft(blankClock); await refresh()
    })
  }

  const proposeFaction = (clock: FactionClock) => void run(`propose-${clock.id}`, async () => {
    await api(`/api/campaign/intelligence/factions/${clock.id}/proposals`, { method: 'POST', headers: authorization, body: JSON.stringify({ sessionId: selectedSession }) })
    await refresh()
  })

  const decideFaction = (proposalId: string, action: 'accept' | 'reject') => void run(`decision-${proposalId}`, async () => {
    await api(`/api/campaign/intelligence/faction-proposals/${proposalId}/decision`, { method: 'POST', headers: authorization, body: JSON.stringify({ action }) })
    await refresh()
  })

  const createSpotlight = () => void run('spotlight', async () => {
    const result = await api<{ report: SpotlightReport }>('/api/campaign/intelligence/spotlight/report', { method: 'POST', headers: authorization, body: JSON.stringify({ sessionId: selectedSession }) })
    setSpotlight(result.report)
  })

  return <div className="drawer-layer drawer-layer--right" role="dialog" aria-modal="true" aria-labelledby="intelligence-heading">
    <button className="drawer-scrim" onClick={onClose} aria-label="Close campaign intelligence" />
    <aside className="intelligence-folio">
      <div className="drawer-heading"><div><span id="intelligence-heading">Campaign intelligence</span><small>Proposals, never authority</small></div><button className="icon-button" onClick={onClose} aria-label="Close campaign intelligence"><X size={18} /></button></div>
      {error && <div className="folio-error" role="alert">{error}</div>}

      <section className="intelligence-section" aria-labelledby="memory-query-heading">
        <div className="intelligence-section__heading"><span>Character recollection</span><h2 id="memory-query-heading">Ask only what this seat can know</h2></div>
        <form className="intelligence-form" onSubmit={askKnowledge}><label htmlFor="knowledge-question">Question</label><textarea id="knowledge-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="What do I know about the western archive?" /><button className="folio-button" disabled={!question.trim() || pending === 'knowledge'}>{pending === 'knowledge' ? 'Reading…' : 'Ask from canon'}</button></form>
        {knowledge && <article className="knowledge-answer"><p>{knowledge.answer}</p><ol>{knowledge.citations.map((entry) => <li key={entry.id}><strong>{entry.title}</strong><span>{entry.claim}</span></li>)}</ol></article>}
      </section>

      <section className="intelligence-section" aria-labelledby="intent-heading">
        <div className="intelligence-section__heading"><span>Intent studio</span><h2 id="intent-heading">Find your character’s words</h2></div>
        <form className="intelligence-form" onSubmit={draftIntent}><label htmlFor="character-intent">What do you intend?</label><textarea id="character-intent" value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={500} placeholder="Warn the others without alarming the guard." /><button className="folio-button" disabled={!intent.trim() || pending === 'intent'}>{pending === 'intent' ? 'Drafting…' : 'Offer phrasings'}</button></form>
        {drafts.length > 0 && <ol className="intent-drafts">{drafts.map((item) => <li key={item}><q>{item}</q><button className="folio-small-action" onClick={() => { onUseDraft(item); onClose() }}>Use in composer</button></li>)}</ol>}
      </section>

      <section className="intelligence-section spotlight-consent" aria-labelledby="spotlight-consent-heading"><div><span>Spotlight consent</span><h2 id="spotlight-consent-heading">Include my future text activity</h2><p>Optional reports count messages after you opt in. They do not record audio or infer emotion, intent, or engagement.</p></div><button className={consent ? 'folio-button consent-on' : 'folio-button'} onClick={toggleConsent} disabled={pending === 'consent'}>{consent ? <><Check size={14} />Opted in</> : 'Opt in'}</button></section>

      {isGm && overview && <>
        <section className="intelligence-section" aria-labelledby="preparation-heading">
          <div className="intelligence-section__heading"><span>Post-session preparation</span><h2 id="preparation-heading">Automation must earn its place</h2></div>
          <div className={overview.readiness.eligible ? 'eligibility-note eligibility-note--ready' : 'eligibility-note'}><strong>{overview.readiness.eligible ? 'Release gates passed' : 'Still gathering evidence'}</strong><span>{overview.readiness.checks.filter((check) => check.passed).length}/{overview.readiness.checks.length} gates passed · drafts remain private until a GM acts</span></div>
          <div className="preparation-controls"><label><input type="checkbox" checked={overview.settings.autoPrepare} onChange={(event) => setOverview({ ...overview, settings: { ...overview.settings, autoPrepare: event.target.checked } })} disabled={!overview.readiness.eligible} />Prepare after a session closes</label>{(['canon', 'continuity', 'recap'] as const).map((task) => <label key={task}><input type="checkbox" checked={overview.settings.tasks[task]} onChange={(event) => setOverview({ ...overview, settings: { ...overview.settings, tasks: { ...overview.settings.tasks, [task]: event.target.checked } } })} />{task === 'canon' ? 'Canon suggestions' : task === 'continuity' ? 'Continuity brief' : 'Recap draft'}</label>)}<button className="folio-button" onClick={savePreparation} disabled={pending === 'settings'}>Save preparation</button></div>
          <div className="intelligence-inline"><select aria-label="Preparation session" value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>{sessions.filter((item) => item.status === 'closed').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="folio-button" onClick={prepareSession} disabled={!selectedSession || !overview.readiness.eligible || pending === 'prepare'}>{pending === 'prepare' ? 'Queuing…' : 'Prepare now'}</button></div>
          {overview.preparationRuns.length > 0 && <ol className="preparation-runs">{overview.preparationRuns.slice(0, 5).map((runItem) => <li key={runItem.id}><span>{sessions.find((item) => item.id === runItem.sessionId)?.title ?? 'Campaign session'}</span><strong>{runItem.status}</strong>{runItem.error && <small>{runItem.error}</small>}</li>)}</ol>}
        </section>

        <section className="intelligence-section" aria-labelledby="house-rules-heading">
          <div className="intelligence-section__heading"><span>Negotiated rules</span><h2 id="house-rules-heading">The table’s ruling, with its reasoning intact</h2></div>
          <form className="intelligence-form rule-form" onSubmit={saveRule}><label htmlFor="rule-title">Title</label><input id="rule-title" value={ruleDraft.title} onChange={(event) => setRuleDraft({ ...ruleDraft, title: event.target.value })} maxLength={120} /><label htmlFor="rule-source">Source rule</label><textarea id="rule-source" value={ruleDraft.sourceRule} onChange={(event) => setRuleDraft({ ...ruleDraft, sourceRule: event.target.value })} maxLength={1_000} /><label htmlFor="rule-interpretation">Interpretation</label><textarea id="rule-interpretation" value={ruleDraft.interpretation} onChange={(event) => setRuleDraft({ ...ruleDraft, interpretation: event.target.value })} maxLength={2_000} /><label htmlFor="rule-ruling">Table ruling</label><textarea id="rule-ruling" value={ruleDraft.ruling} onChange={(event) => setRuleDraft({ ...ruleDraft, ruling: event.target.value })} maxLength={2_000} /><label htmlFor="rule-reason">Reason for this revision</label><input id="rule-reason" value={ruleDraft.reason} onChange={(event) => setRuleDraft({ ...ruleDraft, reason: event.target.value })} maxLength={500} /><div className="intelligence-actions"><button className="primary-action" disabled={pending === 'rule' || Object.values(ruleDraft).some((value) => !String(value).trim())}>{editingRule ? 'Save revision' : 'Record ruling'}</button>{editingRule && <button type="button" className="folio-button" onClick={() => { setEditingRule(null); setRuleDraft(blankRule) }}>Cancel</button>}</div></form>
          <ol className="rule-ledger">{rules.map((rule) => <li key={rule.id}><div><span>{rule.status} · revision {rule.revision}</span><h3>{rule.title}</h3></div><dl><dt>Source</dt><dd>{rule.sourceRule}</dd><dt>Interpretation</dt><dd>{rule.interpretation}</dd><dt>Ruling</dt><dd>{rule.ruling}</dd></dl><div className="intelligence-actions"><button className="folio-small-action" onClick={() => editRule(rule)}>Revise</button>{rule.status === 'active' && <button className="folio-small-action" onClick={() => retireRule(rule)}>Retire</button>}</div></li>)}</ol>
        </section>

        <section className="intelligence-section" aria-labelledby="faction-heading">
          <div className="intelligence-section__heading"><span>Faction clocks</span><h2 id="faction-heading">Possible motion between sessions</h2></div>
          <form className="intelligence-form clock-form" onSubmit={createClock}><label htmlFor="clock-name">Faction</label><input id="clock-name" value={clockDraft.name} onChange={(event) => setClockDraft({ ...clockDraft, name: event.target.value })} maxLength={120} /><label htmlFor="clock-goal">Goal</label><textarea id="clock-goal" value={clockDraft.goal} onChange={(event) => setClockDraft({ ...clockDraft, goal: event.target.value })} maxLength={1_000} /><div className="clock-values"><label>Current<input type="number" min="0" max={clockDraft.segments} value={clockDraft.progress} onChange={(event) => setClockDraft({ ...clockDraft, progress: Number(event.target.value) })} /></label><label>Segments<input type="number" min="2" max="12" value={clockDraft.segments} onChange={(event) => setClockDraft({ ...clockDraft, segments: Number(event.target.value) })} /></label></div><button className="folio-button" disabled={pending === 'clock' || !clockDraft.name.trim() || !clockDraft.goal.trim()}><Plus size={14} />Add clock</button></form>
          <ol className="faction-ledger">{overview.factionClocks.map((clock) => <li key={clock.id}><div className="clock-heading"><div><span>{clock.progress}/{clock.segments}</span><h3>{clock.name}</h3><p>{clock.goal}</p></div><div className="clock-track" aria-label={`${clock.progress} of ${clock.segments} segments complete`}>{Array.from({ length: clock.segments }, (_, index) => <i key={index} className={index < clock.progress ? 'filled' : ''} />)}</div></div><button className="folio-small-action" onClick={() => proposeFaction(clock)} disabled={!selectedSession || pending === `propose-${clock.id}`}>{pending === `propose-${clock.id}` ? 'Considering…' : 'Propose next motion'}</button>{clock.proposals.filter((proposal) => proposal.status === 'proposed').map((proposal) => <article className="faction-proposal" key={proposal.id}><strong>Proposed: {proposal.proposedProgress}/{clock.segments}</strong><p>{proposal.summary}</p><small>Assumptions: {proposal.assumptions}</small><div className="intelligence-actions"><button className="folio-small-action" onClick={() => decideFaction(proposal.id, 'accept')}>Accept change</button><button className="folio-small-action" onClick={() => decideFaction(proposal.id, 'reject')}>Reject</button></div></article>)}</li>)}</ol>
        </section>

        <section className="intelligence-section" aria-labelledby="spotlight-heading"><div className="intelligence-section__heading"><span>Opt-in spotlight</span><h2 id="spotlight-heading">A count, not a judgement</h2></div><p className="intelligence-explainer">Only opted-in text messages sent after consent are counted. Absence, emotion, attention, and voice are never inferred.</p><div className="intelligence-inline"><select aria-label="Spotlight session" value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>{sessions.filter((item) => item.status === 'closed').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="folio-button" onClick={createSpotlight} disabled={!selectedSession || pending === 'spotlight'}>Count opted-in text</button></div>{spotlight && (spotlight.participants.length ? <ol className="spotlight-report">{spotlight.participants.map((participant) => <li key={participant.id}><strong>{participant.name}</strong><span>{participant.messages} messages · {Math.round(participant.share * 100)}%</span></li>)}</ol> : <p className="intelligence-empty">No opted-in text was recorded during this session.</p>)}</section>
      </>}
    </aside>
  </div>
}
