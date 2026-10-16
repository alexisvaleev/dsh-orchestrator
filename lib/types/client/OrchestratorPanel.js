import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sidebar footer entry for multi-agent orchestration: a compact "Orchestrate"
 * badge that opens a panel with a submit form, the run list, each run's task
 * tree, the validator verdict, and — for `awaiting-approval` runs — the
 * proposed diff with an acknowledge-gated Apply and a Discard control.
 * The run list arrives through the injected `runs` hook fed by the
 * `orchestrator` Remote stream; every mutation goes through a unary Remote.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RiskConfirmation, Tooltip, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './OrchestratorPanel.module.css';
/** Gap kept between the fixed panel and its trigger, in pixels. */
const PANEL_GAP = 8;
/** State-dot state per run status. */
function dotState(status) {
    switch (status) {
        case 'planning':
        case 'running': return 'working';
        case 'awaiting-approval':
        case 'applied':
        case 'done': return 'ok';
        case 'failed':
        case 'cancelled':
        case 'interrupted': return 'error';
        case 'discarded': return 'default';
    }
}
/** One node row inside the run's task tree. */
function NodeRow({ node, depth, t }) {
    return (_jsxs("li", { className: css.node, "data-status": node.status, style: { paddingLeft: `${depth * 14}px` }, children: [_jsx("span", { className: css.nodeStatus, "aria-hidden": true, children: statusGlyph(node.status) }), _jsx("span", { className: css.nodeTitle, title: node.title, children: node.title }), _jsx("span", { className: css.nodeRole, children: t(`role.${node.role}`) }), node.route.model !== undefined && _jsx("span", { className: css.nodeModel, children: node.route.model }), node.attempts > 1 && _jsx("span", { className: css.nodeAttempts, children: t('node.attempts', { count: node.attempts }) }), node.error !== null && _jsx("span", { className: css.nodeError, children: node.error })] }));
}
/** Status glyph per node state. */
function statusGlyph(status) {
    switch (status) {
        case 'pending': return '○';
        case 'running': return '◐';
        case 'done': return '●';
        case 'failed': return '✕';
        case 'skipped': return '◌';
    }
}
/** A run's node list rendered with dependency depth for indentation. */
function NodeList({ run, t }) {
    if (run.nodes.length === 0)
        return _jsx("p", { className: css.note, children: t('run.nodes.empty') });
    const byId = new Map(run.nodes.map(node => [node.id, node]));
    const memo = new Map();
    const depthOf = (id) => {
        const hit = memo.get(id);
        if (hit !== undefined)
            return hit;
        const parent = byId.get(id)?.parentId;
        // Guard against self-reference in a malformed record.
        const depth = parent === null || parent === undefined || parent === id ? 0 : depthOf(parent) + 1;
        memo.set(id, depth);
        return depth;
    };
    return (_jsx("ul", { className: css.nodeList, children: run.nodes.map(node => _jsx(NodeRow, { node: node, depth: depthOf(node.id), t: t }, node.id)) }));
}
/** The proposal block: stat, diff preview, acknowledge-gated Apply, Discard. */
function ProposalBlock({ run, busy, onApply, onDiscard, t }) {
    const proposal = run.proposal;
    const [confirming, setConfirming] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const closeConfirm = () => {
        setConfirming(false);
        setAcknowledged(false);
    };
    return (_jsxs("section", { className: css.proposal, children: [_jsx("h4", { className: css.group, children: t('proposal.title') }), _jsx("p", { className: css.note, children: t('proposal.stat', { stat: proposal.stat.trim() }) }), _jsx("pre", { className: css.diff, "aria-label": t('proposal.title'), children: proposal.diff.split('\n').map((line, i) => (_jsxs("span", { className: line.startsWith('--- ') || line.startsWith('+++ ') ? css.diffHunk
                        : line.startsWith('+') ? css.diffAdd
                            : line.startsWith('-') ? css.diffDel
                                : line.startsWith('@@') ? css.diffHunk : undefined, children: [line, '\n'] }, i))) }), _jsx("p", { className: css.note, children: t('proposal.review') }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", className: css.primary, disabled: busy, onClick: () => { setConfirming(true); }, children: t('proposal.apply') }), _jsx("button", { type: "button", className: css.plain, disabled: busy, onClick: () => { void onDiscard(); }, children: t('proposal.discard') })] }), _jsx(RiskConfirmation, { open: confirming, title: t('confirm.title'), description: t('confirm.description'), acknowledgeLabel: t('proposal.acknowledge'), cancelLabel: t('confirm.cancel'), closeLabel: t('confirm.close'), confirmLabel: t('confirm.apply'), acknowledged: acknowledged, disabled: busy, onAcknowledgedChange: setAcknowledged, onCancel: closeConfirm, onConfirm: () => {
                    closeConfirm();
                    void onApply(proposal.hash);
                } })] }));
}
/** One run card: header, node tree, validation, proposal controls. */
function RunCard({ run, busy, onCancel, onApply, onDiscard, t }) {
    const [open, setOpen] = useState(run.status === 'awaiting-approval');
    useEffect(() => {
        if (run.status === 'awaiting-approval' && run.proposal !== null)
            setOpen(true);
    }, [run.status, run.proposal]);
    const live = run.status === 'planning' || run.status === 'running';
    return (_jsxs("article", { className: css.run, "data-status": run.status, children: [_jsxs("button", { type: "button", className: css.runHeader, onClick: () => { setOpen(v => !v); }, "aria-expanded": open, children: [_jsx("span", { className: css.runDot, "data-state": dotState(run.status), "aria-hidden": true }), _jsx("span", { className: css.runTask, title: run.task, children: run.task }), _jsx("span", { className: css.runStatus, children: t(`run.status.${run.status}`) })] }), open && (_jsxs("div", { className: css.runBody, children: [_jsx(NodeList, { run: run, t: t }), run.validation !== null && (_jsx("p", { className: css.note, "data-verdict": run.validation.verdict, children: t('run.validation', { verdict: run.validation.verdict, summary: run.validation.summary }) })), run.error !== null && _jsx("p", { className: css.readError, role: "alert", children: t('run.error', { message: run.error }) }), run.status === 'awaiting-approval' && run.proposal !== null && (_jsx(ProposalBlock, { run: run, busy: busy, onApply: hash => onApply(run.id, hash), onDiscard: () => onDiscard(run.id), t: t })), live && (_jsx("div", { className: css.actions, children: _jsx("button", { type: "button", className: css.plain, disabled: busy, onClick: () => { void onCancel(run.id); }, children: t('run.cancel') }) }))] }))] }));
}
/** The submit form: task text plus the target repository's absolute path. */
function SubmitForm({ busy, onSubmit, t }) {
    const [task, setTask] = useState('');
    const [cwd, setCwd] = useState('');
    const [error, setError] = useState(null);
    const submit = (event) => {
        event.preventDefault();
        if (busy || task.trim().length === 0 || cwd.trim().length === 0)
            return;
        setError(null);
        void onSubmit({ task: task.trim(), cwd: cwd.trim() })
            .then(() => { setTask(''); })
            .catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    return (_jsxs("form", { className: css.submit, onSubmit: submit, children: [_jsx("h4", { className: css.group, children: t('submit.title') }), _jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('submit.task') }), _jsx("textarea", { className: css.textarea, rows: 3, placeholder: t('submit.taskPlaceholder'), value: task, onChange: e => { setTask(e.target.value); } })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('submit.cwd') }), _jsx("input", { className: css.input, placeholder: t('submit.cwdPlaceholder'), autoComplete: "off", value: cwd, onChange: e => { setCwd(e.target.value); } })] }), error !== null && _jsx("p", { className: css.readError, role: "alert", children: t('submit.failed', { message: error }) }), _jsx("button", { type: "submit", className: css.primary, disabled: busy || task.trim().length === 0 || cwd.trim().length === 0, children: t('submit.go') })] }));
}
/**
 * Footer action rendering the orchestration panel. The badge shows only when
 * the Host namespace is present; the stream failure path publishes nothing,
 * so a Host without the controller keeps the feature invisible.
 */
export function OrchestratorPanel({ wide, useRuns, submit, cancel, apply, discard, t }) {
    const runs = useRuns(state => state);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const rootRef = useRef(null);
    const [anchor, setAnchor] = useState();
    useLayoutEffect(() => {
        if (!open)
            return;
        const place = () => {
            const rect = rootRef.current?.getBoundingClientRect();
            if (rect !== undefined) {
                setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + PANEL_GAP });
            }
        };
        place();
        window.addEventListener('resize', place);
        return () => { window.removeEventListener('resize', place); };
    }, [open]);
    useDismissOnOutsidePointer(rootRef, open, setOpen);
    const onKeyDown = (event) => {
        if (event.key !== 'Escape' || !open)
            return;
        event.preventDefault();
        setOpen(false);
    };
    const guarded = (fn) => async () => {
        setBusy(true);
        try {
            await fn();
        }
        finally {
            setBusy(false);
        }
    };
    let active = null;
    if (runs !== undefined && runs.some(run => run.status === 'running' || run.status === 'planning')) {
        active = _jsx("span", { className: css.badgeDot, "data-state": "working", "aria-hidden": true });
    }
    else if (runs !== undefined && runs.some(run => run.status === 'awaiting-approval')) {
        active = _jsx("span", { className: css.badgeDot, "data-state": "ok", "aria-hidden": true });
    }
    return (_jsxs("div", { ref: rootRef, className: wide ? css.layer : `${css.layer} ${css.rail}`, onKeyDown: onKeyDown, children: [open && anchor !== undefined && (_jsxs("section", { className: css.panel, style: anchor, "aria-label": t('panel.title'), children: [_jsx("header", { className: css.header, children: _jsx("span", { className: css.title, children: t('panel.title') }) }), _jsxs("div", { className: css.body, children: [_jsx(SubmitForm, { busy: busy, onSubmit: input => guarded(() => submit(input))(), t: t }), (runs === undefined || runs.length === 0) && _jsx("p", { className: css.note, children: t('panel.empty') }), runs?.map(run => (_jsx(RunCard, { run: run, busy: busy, onCancel: runId => guarded(() => cancel(runId))(), onApply: (runId, hash) => guarded(() => apply(runId, hash))(), onDiscard: runId => guarded(() => discard(runId))(), t: t }, run.id)))] })] })), _jsx(Tooltip, { label: t('badge.aria'), side: wide ? 'top' : 'right', delayMs: 500, children: _jsxs("button", { type: "button", className: css.badge, "aria-label": t('badge.aria'), "aria-expanded": open, onClick: () => { setOpen(value => !value); }, children: [active, wide && _jsx("span", { className: css.badgeLabel, children: t('badge.label') })] }) })] }));
}
//# sourceMappingURL=OrchestratorPanel.js.map