# dsh-ui-orchestrator

Client half of `dsh-orchestrator`: a sidebar-footer badge that opens the
orchestration panel — submit form, run list, per-run task tree, validator
verdict, proposed diff with acknowledge-gated Apply, and Discard/Cancel.

The panel reads runs through the `orchestrator/watch` Remote stream and calls
unary methods (`submit`, `cancel`, `apply`, `discard`) for every action. When
the Host plugin is absent the watch fails once and the panel shows the empty
state — the feature stays quiet in deployments that do not install it.
