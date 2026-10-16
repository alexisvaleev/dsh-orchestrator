/* Emitted by scripts/emit-typert.mjs — regenerating in-monorepo with
 * @deepseek-ai/dsh-typert-generator produces the equivalent artifacts. */
import { z } from 'zod'

let _dsh_orchestrator_orchestrator_submit_parameter_0$schema$value
const _dsh_orchestrator_orchestrator_submit_parameter_0$schema = () => (_dsh_orchestrator_orchestrator_submit_parameter_0$schema$value ??= z.object({
  'task': z.string().readonly(),
  'cwd': z.string().readonly(),
  'mode': z.union([z.literal(undefined), z.enum(['auto', 'parallel', 'hierarchical'])]),
  'routes': z.union([z.literal(undefined), z.object({
    'planner': z.union([z.literal(undefined), z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly()]),
    'worker': z.union([z.literal(undefined), z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly()]),
    'validator': z.union([z.literal(undefined), z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly()]),
  })]),
}).readonly())

let _dsh_orchestrator_orchestrator_submit_result$schema$value
const _dsh_orchestrator_orchestrator_submit_result$schema = () => (_dsh_orchestrator_orchestrator_submit_result$schema$value ??= z.object({
  'id': z.string().readonly(),
  'task': z.string().readonly(),
  'cwd': z.string().readonly(),
  'status': z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']).readonly(),
  'createdAt': z.number().readonly(),
  'updatedAt': z.number().readonly(),
  'worktree': z.union([z.literal(null), z.string().readonly()]),
  'nodes': z.array(z.object({
  'id': z.string().readonly(),
  'title': z.string().readonly(),
  'parentId': z.union([z.literal(null), z.string().readonly()]),
  'deps': z.array(z.string().readonly()).readonly(),
  'role': z.enum(['worker', 'aggregate', 'validator']).readonly(),
  'route': z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly(),
  'status': z.enum(['pending', 'running', 'done', 'failed', 'skipped']).readonly(),
  'attempts': z.number().readonly(),
  'output': z.union([z.literal(null), z.string().readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()).readonly(),
  'proposal': z.union([z.literal(null), z.object({
  'hash': z.string().readonly(),
  'baseRev': z.string().readonly(),
  'stat': z.string().readonly(),
  'diff': z.string().readonly(),
}).readonly()]),
  'validation': z.union([z.literal(null), z.object({
  'verdict': z.enum(['pass', 'fail']).readonly(),
  'summary': z.string().readonly(),
  'issues': z.array(z.string().readonly()).readonly(),
}).readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly())

let _dsh_orchestrator_orchestrator_listRuns_result$schema$value
const _dsh_orchestrator_orchestrator_listRuns_result$schema = () => (_dsh_orchestrator_orchestrator_listRuns_result$schema$value ??= z.array(z.object({
  'id': z.string().readonly(),
  'task': z.string().readonly(),
  'cwd': z.string().readonly(),
  'status': z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']).readonly(),
  'createdAt': z.number().readonly(),
  'updatedAt': z.number().readonly(),
  'worktree': z.union([z.literal(null), z.string().readonly()]),
  'nodes': z.array(z.object({
  'id': z.string().readonly(),
  'title': z.string().readonly(),
  'parentId': z.union([z.literal(null), z.string().readonly()]),
  'deps': z.array(z.string().readonly()).readonly(),
  'role': z.enum(['worker', 'aggregate', 'validator']).readonly(),
  'route': z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly(),
  'status': z.enum(['pending', 'running', 'done', 'failed', 'skipped']).readonly(),
  'attempts': z.number().readonly(),
  'output': z.union([z.literal(null), z.string().readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()).readonly(),
  'proposal': z.union([z.literal(null), z.object({
  'hash': z.string().readonly(),
  'baseRev': z.string().readonly(),
  'stat': z.string().readonly(),
  'diff': z.string().readonly(),
}).readonly()]),
  'validation': z.union([z.literal(null), z.object({
  'verdict': z.enum(['pass', 'fail']).readonly(),
  'summary': z.string().readonly(),
  'issues': z.array(z.string().readonly()).readonly(),
}).readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()))

let _dsh_orchestrator_orchestrator_getRun_parameter_0$schema$value
const _dsh_orchestrator_orchestrator_getRun_parameter_0$schema = () => (_dsh_orchestrator_orchestrator_getRun_parameter_0$schema$value ??= z.string().readonly())

let _dsh_orchestrator_orchestrator_getRun_result$schema$value
const _dsh_orchestrator_orchestrator_getRun_result$schema = () => (_dsh_orchestrator_orchestrator_getRun_result$schema$value ??= z.union([z.literal(null), z.object({
  'id': z.string().readonly(),
  'task': z.string().readonly(),
  'cwd': z.string().readonly(),
  'status': z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']).readonly(),
  'createdAt': z.number().readonly(),
  'updatedAt': z.number().readonly(),
  'worktree': z.union([z.literal(null), z.string().readonly()]),
  'nodes': z.array(z.object({
  'id': z.string().readonly(),
  'title': z.string().readonly(),
  'parentId': z.union([z.literal(null), z.string().readonly()]),
  'deps': z.array(z.string().readonly()).readonly(),
  'role': z.enum(['worker', 'aggregate', 'validator']).readonly(),
  'route': z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly(),
  'status': z.enum(['pending', 'running', 'done', 'failed', 'skipped']).readonly(),
  'attempts': z.number().readonly(),
  'output': z.union([z.literal(null), z.string().readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()).readonly(),
  'proposal': z.union([z.literal(null), z.object({
  'hash': z.string().readonly(),
  'baseRev': z.string().readonly(),
  'stat': z.string().readonly(),
  'diff': z.string().readonly(),
}).readonly()]),
  'validation': z.union([z.literal(null), z.object({
  'verdict': z.enum(['pass', 'fail']).readonly(),
  'summary': z.string().readonly(),
  'issues': z.array(z.string().readonly()).readonly(),
}).readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()]))

let _dsh_orchestrator_orchestrator_watch_result$schema$value
const _dsh_orchestrator_orchestrator_watch_result$schema = () => (_dsh_orchestrator_orchestrator_watch_result$schema$value ??= z.array(z.object({
  'id': z.string().readonly(),
  'task': z.string().readonly(),
  'cwd': z.string().readonly(),
  'status': z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']).readonly(),
  'createdAt': z.number().readonly(),
  'updatedAt': z.number().readonly(),
  'worktree': z.union([z.literal(null), z.string().readonly()]),
  'nodes': z.array(z.object({
  'id': z.string().readonly(),
  'title': z.string().readonly(),
  'parentId': z.union([z.literal(null), z.string().readonly()]),
  'deps': z.array(z.string().readonly()).readonly(),
  'role': z.enum(['worker', 'aggregate', 'validator']).readonly(),
  'route': z.object({
  'provider': z.union([z.literal(undefined), z.string().readonly()]),
  'model': z.union([z.literal(undefined), z.string().readonly()]),
  'reasoningEffort': z.union([z.literal(undefined), z.string().readonly()]),
}).readonly(),
  'status': z.enum(['pending', 'running', 'done', 'failed', 'skipped']).readonly(),
  'attempts': z.number().readonly(),
  'output': z.union([z.literal(null), z.string().readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()).readonly(),
  'proposal': z.union([z.literal(null), z.object({
  'hash': z.string().readonly(),
  'baseRev': z.string().readonly(),
  'stat': z.string().readonly(),
  'diff': z.string().readonly(),
}).readonly()]),
  'validation': z.union([z.literal(null), z.object({
  'verdict': z.enum(['pass', 'fail']).readonly(),
  'summary': z.string().readonly(),
  'issues': z.array(z.string().readonly()).readonly(),
}).readonly()]),
  'error': z.union([z.literal(null), z.string().readonly()]),
}).readonly()))

let _dsh_orchestrator_orchestrator_cancel_parameter_0$schema$value
const _dsh_orchestrator_orchestrator_cancel_parameter_0$schema = () => (_dsh_orchestrator_orchestrator_cancel_parameter_0$schema$value ??= z.string().readonly())

let _dsh_orchestrator_orchestrator_cancel_result$schema$value
const _dsh_orchestrator_orchestrator_cancel_result$schema = () => (_dsh_orchestrator_orchestrator_cancel_result$schema$value ??= z.void())

let _dsh_orchestrator_orchestrator_apply_parameter_0$schema$value
const _dsh_orchestrator_orchestrator_apply_parameter_0$schema = () => (_dsh_orchestrator_orchestrator_apply_parameter_0$schema$value ??= z.string().readonly())

let _dsh_orchestrator_orchestrator_apply_parameter_1$schema$value
const _dsh_orchestrator_orchestrator_apply_parameter_1$schema = () => (_dsh_orchestrator_orchestrator_apply_parameter_1$schema$value ??= z.string().readonly())

let _dsh_orchestrator_orchestrator_apply_result$schema$value
const _dsh_orchestrator_orchestrator_apply_result$schema = () => (_dsh_orchestrator_orchestrator_apply_result$schema$value ??= z.void())

let _dsh_orchestrator_orchestrator_discard_parameter_0$schema$value
const _dsh_orchestrator_orchestrator_discard_parameter_0$schema = () => (_dsh_orchestrator_orchestrator_discard_parameter_0$schema$value ??= z.string().readonly())

let _dsh_orchestrator_orchestrator_discard_result$schema$value
const _dsh_orchestrator_orchestrator_discard_result$schema = () => (_dsh_orchestrator_orchestrator_discard_result$schema$value ??= z.void())

let _dsh_orchestrator_orchestrator_listRoutes_result$schema$value
const _dsh_orchestrator_orchestrator_listRoutes_result$schema = () => (_dsh_orchestrator_orchestrator_listRoutes_result$schema$value ??= z.array(z.object({
  'provider': z.string().readonly(),
  'models': z.array(z.object({
    'id': z.string().readonly(),
    'name': z.union([z.literal(null), z.string().readonly()]),
  }).readonly()).readonly(),
}).readonly()))

export const TYPERT = {
  package: 'dsh-orchestrator',
  face: 'host',
  schemas: [
  ],
  invocations: [
    {
      id: 'dsh-orchestrator#orchestrator/submit',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'submit',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'input',
          wire: 'input',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/submit:input',
            create: _dsh_orchestrator_orchestrator_submit_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#OrchestratorRunView',
        create: _dsh_orchestrator_orchestrator_submit_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/listRuns',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'listRuns',
      invocation: { kind: 'direct' },
      parameters: [

      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#OrchestratorRunView',
        create: _dsh_orchestrator_orchestrator_listRuns_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/getRun',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'getRun',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'runId',
          wire: 'runId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/getRun:runId',
            create: _dsh_orchestrator_orchestrator_getRun_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#OrchestratorRunView',
        create: _dsh_orchestrator_orchestrator_getRun_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/watch',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'watch',
      mode: 'stream',
      invocation: { kind: 'direct' },
      parameters: [

      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#OrchestratorRunView',
        create: _dsh_orchestrator_orchestrator_watch_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/cancel',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'cancel',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'runId',
          wire: 'runId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/cancel:runId',
            create: _dsh_orchestrator_orchestrator_cancel_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#void',
        create: _dsh_orchestrator_orchestrator_cancel_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/apply',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'apply',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'runId',
          wire: 'runId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/apply:runId',
            create: _dsh_orchestrator_orchestrator_apply_parameter_0$schema,
          },
        },
        {
          name: 'hash',
          wire: 'hash',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/apply:hash',
            create: _dsh_orchestrator_orchestrator_apply_parameter_1$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#void',
        create: _dsh_orchestrator_orchestrator_apply_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/discard',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'discard',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'runId',
          wire: 'runId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-orchestrator#orchestrator/discard:runId',
            create: _dsh_orchestrator_orchestrator_discard_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#void',
        create: _dsh_orchestrator_orchestrator_discard_result$schema,
      },
    },
    {
      id: 'dsh-orchestrator#orchestrator/listRoutes',
      service: 'orchestratorController',
      namespace: 'orchestrator',
      method: 'listRoutes',
      invocation: { kind: 'direct' },
      parameters: [

      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-orchestrator/types#OrchestratorRouteCatalog',
        create: _dsh_orchestrator_orchestrator_listRoutes_result$schema,
      },
    },
  ],
  model: { services: [], events: [], objects: [] },
}
