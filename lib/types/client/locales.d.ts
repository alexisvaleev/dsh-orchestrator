/** `orchestrator` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "orchestrator";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'badge.aria': "多代理编排";
    readonly 'badge.label': "编排";
    readonly 'panel.title': "编排运行";
    readonly 'panel.empty': "暂无编排运行。";
    readonly 'submit.title': "新任务";
    readonly 'submit.task': "任务描述";
    readonly 'submit.taskPlaceholder': "描述要拆解并行执行的复杂任务…";
    readonly 'submit.cwd': "仓库路径";
    readonly 'submit.cwdPlaceholder': "/path/to/repo";
    readonly 'submit.go': "开始编排";
    readonly 'submit.failed': "提交失败：{message}";
    readonly 'run.status.planning': "规划中";
    readonly 'run.status.running': "执行中";
    readonly 'run.status.awaiting-approval': "待批准";
    readonly 'run.status.applied': "已应用";
    readonly 'run.status.done': "已完成";
    readonly 'run.status.failed': "失败";
    readonly 'run.status.cancelled': "已取消";
    readonly 'run.status.interrupted': "已中断";
    readonly 'run.status.discarded': "已放弃";
    readonly 'run.nodes': "任务节点";
    readonly 'run.nodes.empty': "规划尚未产出子任务。";
    readonly 'run.validation': "验证结论：{verdict} — {summary}";
    readonly 'run.error': "错误：{message}";
    readonly 'run.cancel': "取消运行";
    readonly 'proposal.title': "提议的改动";
    readonly 'proposal.stat': "{stat}";
    readonly 'proposal.review': "请在应用前审阅 diff。应用在目标仓库当前 HEAD 上进行。";
    readonly 'proposal.apply': "应用改动";
    readonly 'proposal.discard': "放弃并清理 worktree";
    readonly 'proposal.acknowledge': "我已审阅 diff，理解它将被应用到目标仓库。";
    readonly 'confirm.title': "应用编排改动";
    readonly 'confirm.description': "将已审阅的 diff 应用到目标仓库的当前 HEAD。此操作会修改你的工作区文件。";
    readonly 'confirm.cancel': "取消";
    readonly 'confirm.close': "关闭";
    readonly 'confirm.apply': "应用";
    readonly 'role.worker': "执行";
    readonly 'role.aggregate': "聚合";
    readonly 'role.validator': "验证";
    readonly 'node.attempts': "第 {count} 次尝试";
};
/** Locale key union (the same set in every dictionary). */
export type OrchestratorKey = keyof typeof zh;
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<OrchestratorKey, string>;
//# sourceMappingURL=locales.d.ts.map