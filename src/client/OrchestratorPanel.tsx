/**
 * Sidebar footer entry for multi-agent orchestration: a compact "Orchestrate"
 * badge that opens a panel with a submit form, the run list, each run's task
 * tree, the validator verdict, and — for `awaiting-approval` runs — the
 * proposed diff with an acknowledge-gated Apply and a Discard control.
 * The run list arrives through the injected `runs` hook fed by the
 * `orchestrator` Remote stream; every mutation goes through a unary Remote.
 */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type {
  OrchestratorNodeView,
  OrchestratorRunStatus,
  OrchestratorRunView,
} from 'dsh-orchestrator/types'
import { RiskConfirmation, Tooltip, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './OrchestratorPanel.module.css'

/** One observable bound into a framework selector hook by the renderer. */
interface ObservableSnapshot<T> {
  /** Read the current value. */
  getSnapshot(): T
  /**
   * Subscribe a change listener.
   * @param listener - notified after each publish.
   * @returns unsubscribe disposer.
   */
  subscribe(listener: () => void): () => void
}

/** Registration-side business face for the orchestration panel. */
export interface OrchestratorInjected {
  /** Reactive sources the framework binds as selector hooks. */
  hooks: {
    /** All runs, newest first; `undefined` until the first stream frame lands. */
    runs: ObservableSnapshot<readonly OrchestratorRunView[] | undefined>
  }
  /**
   * Submit a new orchestration task.
   * @param input - task text, absolute repository path, planner mode.
   * @returns resolves after the Host accepted the run.
   */
  submit: (input: { task: string; cwd: string }) => Promise<void>
  /**
   * Cancel a live run.
   * @param runId - run to cancel.
   */
  cancel: (runId: string) => Promise<void>
  /**
   * Apply a reviewed proposal. The Host recomputes the worktree diff and
   * rejects a hash that no longer matches.
   * @param runId - run holding the proposal.
   * @param hash - the `proposal.hash` shown in the panel.
   */
  apply: (runId: string, hash: string) => Promise<void>
  /**
   * Discard a proposal and remove its worktree.
   * @param runId - run to clean up.
   */
  discard: (runId: string) => Promise<void>
}

/** Full props for the sidebar footer orchestration action. */
export type OrchestratorPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>
  & InjectFace<OrchestratorInjected>

/** Gap kept between the fixed panel and its trigger, in pixels. */
const PANEL_GAP = 8

/** State-dot state per run status. */
function dotState(status: OrchestratorRunStatus): 'working' | 'ok' | 'error' | 'default' {
  switch (status) {
    case 'planning':
    case 'running': return 'working'
    case 'awaiting-approval':
    case 'applied':
    case 'done': return 'ok'
    case 'failed':
    case 'cancelled':
    case 'interrupted': return 'error'
    case 'discarded': return 'default'
  }
}

/** One node row inside the run's task tree. */
function NodeRow({ node, depth, t }: { node: OrchestratorNodeView; depth: number; t: TranslateNS<typeof NS> }) {
  return (
    <li className={css.node} data-status={node.status} style={{ paddingLeft: `${depth * 14}px` }}>
      <span className={css.nodeStatus} aria-hidden>{statusGlyph(node.status)}</span>
      <span className={css.nodeTitle} title={node.title}>{node.title}</span>
      <span className={css.nodeRole}>{t(`role.${node.role}`)}</span>
      {node.route.model !== undefined && <span className={css.nodeModel}>{node.route.model}</span>}
      {node.attempts > 1 && <span className={css.nodeAttempts}>{t('node.attempts', { count: node.attempts })}</span>}
      {node.error !== null && <span className={css.nodeError}>{node.error}</span>}
    </li>
  )
}

/** Status glyph per node state. */
function statusGlyph(status: OrchestratorNodeView['status']): string {
  switch (status) {
    case 'pending': return '○'
    case 'running': return '◐'
    case 'done': return '●'
    case 'failed': return '✕'
    case 'skipped': return '◌'
  }
}

/** A run's node list rendered with dependency depth for indentation. */
function NodeList({ run, t }: { run: OrchestratorRunView; t: TranslateNS<typeof NS> }) {
  if (run.nodes.length === 0) return <p className={css.note}>{t('run.nodes.empty')}</p>
  const byId = new Map(run.nodes.map(node => [node.id, node]))
  const memo = new Map<string, number>()
  const depthOf = (id: string): number => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const parent = byId.get(id)?.parentId
    // Guard against self-reference in a malformed record.
    const depth = parent === null || parent === undefined || parent === id ? 0 : depthOf(parent) + 1
    memo.set(id, depth)
    return depth
  }
  return (
    <ul className={css.nodeList}>
      {run.nodes.map(node => <NodeRow key={node.id} node={node} depth={depthOf(node.id)} t={t} />)}
    </ul>
  )
}

/** The proposal block: stat, diff preview, acknowledge-gated Apply, Discard. */
function ProposalBlock({ run, busy, onApply, onDiscard, t }: {
  run: OrchestratorRunView
  busy: boolean
  onApply: (hash: string) => Promise<void>
  onDiscard: () => Promise<void>
  t: TranslateNS<typeof NS>
}) {
  const proposal = run.proposal!
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const closeConfirm = (): void => {
    setConfirming(false)
    setAcknowledged(false)
  }
  return (
    <section className={css.proposal}>
      <h4 className={css.group}>{t('proposal.title')}</h4>
      <p className={css.note}>{t('proposal.stat', { stat: proposal.stat.trim() })}</p>
      <pre className={css.diff} aria-label={t('proposal.title')}>
        {proposal.diff.split('\n').map((line, i) => (
          <span
            key={i}
            className={
              line.startsWith('--- ') || line.startsWith('+++ ') ? css.diffHunk
                : line.startsWith('+') ? css.diffAdd
                  : line.startsWith('-') ? css.diffDel
                    : line.startsWith('@@') ? css.diffHunk : undefined
            }
          >{line}{'\n'}</span>
        ))}
      </pre>
      <p className={css.note}>{t('proposal.review')}</p>
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy} onClick={() => { setConfirming(true) }}>
          {t('proposal.apply')}
        </button>
        <button type="button" className={css.plain} disabled={busy} onClick={() => { void onDiscard() }}>
          {t('proposal.discard')}
        </button>
      </div>
      <RiskConfirmation
        open={confirming}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('proposal.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('confirm.close')}
        confirmLabel={t('confirm.apply')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirm}
        onConfirm={() => {
          closeConfirm()
          void onApply(proposal.hash)
        }}
      />
    </section>
  )
}

/** One run card: header, node tree, validation, proposal controls. */
function RunCard({ run, busy, onCancel, onApply, onDiscard, t }: {
  run: OrchestratorRunView
  busy: boolean
  onCancel: (runId: string) => Promise<void>
  onApply: (runId: string, hash: string) => Promise<void>
  onDiscard: (runId: string) => Promise<void>
  t: TranslateNS<typeof NS>
}) {
  const [open, setOpen] = useState(run.status === 'awaiting-approval')
  useEffect(() => {
    if (run.status === 'awaiting-approval' && run.proposal !== null) setOpen(true)
  }, [run.status, run.proposal])
  const live = run.status === 'planning' || run.status === 'running'
  return (
    <article className={css.run} data-status={run.status}>
      <button type="button" className={css.runHeader} onClick={() => { setOpen(v => !v) }} aria-expanded={open}>
        <span className={css.runDot} data-state={dotState(run.status)} aria-hidden />
        <span className={css.runTask} title={run.task}>{run.task}</span>
        <span className={css.runStatus}>{t(`run.status.${run.status}`)}</span>
      </button>
      {open && (
        <div className={css.runBody}>
          <NodeList run={run} t={t} />
          {run.validation !== null && (
            <p className={css.note} data-verdict={run.validation.verdict}>
              {t('run.validation', { verdict: run.validation.verdict, summary: run.validation.summary })}
            </p>
          )}
          {run.error !== null && <p className={css.readError} role="alert">{t('run.error', { message: run.error })}</p>}
          {run.status === 'awaiting-approval' && run.proposal !== null && (
            <ProposalBlock
              run={run}
              busy={busy}
              onApply={hash => onApply(run.id, hash)}
              onDiscard={() => onDiscard(run.id)}
              t={t}
            />
          )}
          {live && (
            <div className={css.actions}>
              <button type="button" className={css.plain} disabled={busy} onClick={() => { void onCancel(run.id) }}>
                {t('run.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

/** The submit form: task text plus the target repository's absolute path. */
function SubmitForm({ busy, onSubmit, t }: {
  busy: boolean
  onSubmit: (input: { task: string; cwd: string }) => Promise<void>
  t: TranslateNS<typeof NS>
}) {
  const [task, setTask] = useState('')
  const [cwd, setCwd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy || task.trim().length === 0 || cwd.trim().length === 0) return
    setError(null)
    void onSubmit({ task: task.trim(), cwd: cwd.trim() })
      .then(() => { setTask('') })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }
  return (
    <form className={css.submit} onSubmit={submit}>
      <h4 className={css.group}>{t('submit.title')}</h4>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('submit.task')}</span>
        <textarea
          className={css.textarea}
          rows={3}
          placeholder={t('submit.taskPlaceholder')}
          value={task}
          onChange={e => { setTask(e.target.value) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('submit.cwd')}</span>
        <input
          className={css.input}
          placeholder={t('submit.cwdPlaceholder')}
          autoComplete="off"
          value={cwd}
          onChange={e => { setCwd(e.target.value) }}
        />
      </label>
      {error !== null && <p className={css.readError} role="alert">{t('submit.failed', { message: error })}</p>}
      <button type="submit" className={css.primary} disabled={busy || task.trim().length === 0 || cwd.trim().length === 0}>
        {t('submit.go')}
      </button>
    </form>
  )
}

/**
 * Footer action rendering the orchestration panel. The badge shows only when
 * the Host namespace is present; the stream failure path publishes nothing,
 * so a Host without the controller keeps the feature invisible.
 */
export function OrchestratorPanel({ wide, useRuns, submit, cancel, apply, discard, t }: OrchestratorPanelProps) {
  const runs = useRuns(state => state)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect !== undefined) {
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + PANEL_GAP })
      }
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
  }

  const guarded = (fn: () => Promise<void>) => async (): Promise<void> => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  let active: ReactNode = null
  if (runs !== undefined && runs.some(run => run.status === 'running' || run.status === 'planning')) {
    active = <span className={css.badgeDot} data-state="working" aria-hidden />
  } else if (runs !== undefined && runs.some(run => run.status === 'awaiting-approval')) {
    active = <span className={css.badgeDot} data-state="ok" aria-hidden />
  }

  return (
    <div ref={rootRef} className={wide ? css.layer : `${css.layer} ${css.rail}`} onKeyDown={onKeyDown}>
      {open && anchor !== undefined && (
        <section className={css.panel} style={anchor} aria-label={t('panel.title')}>
          <header className={css.header}>
            <span className={css.title}>{t('panel.title')}</span>
          </header>
          <div className={css.body}>
            <SubmitForm busy={busy} onSubmit={input => guarded(() => submit(input))()} t={t} />
            {(runs === undefined || runs.length === 0) && <p className={css.note}>{t('panel.empty')}</p>}
            {runs?.map(run => (
              <RunCard
                key={run.id}
                run={run}
                busy={busy}
                onCancel={runId => guarded(() => cancel(runId))()}
                onApply={(runId, hash) => guarded(() => apply(runId, hash))()}
                onDiscard={runId => guarded(() => discard(runId))()}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
      <Tooltip label={t('badge.aria')} side={wide ? 'top' : 'right'} delayMs={500}>
        <button
          type="button"
          className={css.badge}
          aria-label={t('badge.aria')}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          {active}
          {wide && <span className={css.badgeLabel}>{t('badge.label')}</span>}
        </button>
      </Tooltip>
    </div>
  )
}
