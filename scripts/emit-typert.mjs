/**
 * Emit `lib/typert.host.js` and `lib/typert.remote-client.js` for the
 * `orchestrator` Remote namespace. The upstream generator only runs inside the
 * Harness workspace (its analyzer requires the protocol package as a workspace
 * registration), so this package ships an equivalent declarative emitter.
 * Run after `tsc -b` — the zod schemas mirror `src/types.ts`; keep them in sync.
 * Usage: node scripts/emit-typert.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-orchestrator'
const SERVICE = 'orchestratorController'
const NAMESPACE = 'orchestrator'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** zod expression helpers matching the upstream emitter's output style. */
const zstr = "z.string().readonly()"
const znum = "z.number().readonly()"
const znull = 'z.literal(null)'
const nullable = (inner) => `z.union([${znull}, ${inner}])`
const opt = (inner) => `z.union([z.literal(undefined), ${inner}])`

const routeObj = `z.object({
  'provider': ${opt(zstr)},
  'model': ${opt(zstr)},
  'reasoningEffort': ${opt(zstr)},
}).readonly()`

const nodeObj = `z.object({
  'id': ${zstr},
  'title': ${zstr},
  'parentId': ${nullable(zstr)},
  'deps': z.array(${zstr}).readonly(),
  'role': z.enum(['worker', 'aggregate', 'validator']).readonly(),
  'route': ${routeObj},
  'status': z.enum(['pending', 'running', 'done', 'failed', 'skipped']).readonly(),
  'attempts': ${znum},
  'output': ${nullable(zstr)},
  'error': ${nullable(zstr)},
}).readonly()`

const proposalObj = `z.object({
  'hash': ${zstr},
  'baseRev': ${zstr},
  'stat': ${zstr},
  'diff': ${zstr},
}).readonly()`

const validationObj = `z.object({
  'verdict': z.enum(['pass', 'fail']).readonly(),
  'summary': ${zstr},
  'issues': z.array(${zstr}).readonly(),
}).readonly()`

const runView = `z.object({
  'id': ${zstr},
  'task': ${zstr},
  'cwd': ${zstr},
  'status': z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']).readonly(),
  'createdAt': ${znum},
  'updatedAt': ${znum},
  'worktree': ${nullable(zstr)},
  'nodes': z.array(${nodeObj}).readonly(),
  'proposal': ${nullable(proposalObj)},
  'validation': ${nullable(validationObj)},
  'error': ${nullable(zstr)},
}).readonly()`

const submitInput = `z.object({
  'task': ${zstr},
  'cwd': ${zstr},
  'mode': ${opt(`z.enum(['auto', 'parallel', 'hierarchical'])`)},
  'routes': ${opt(`z.object({
    'planner': ${opt(routeObj)},
    'worker': ${opt(routeObj)},
    'validator': ${opt(routeObj)},
  })`)},
}).readonly()`

const runList = `z.array(${runView})`
const routeCatalog = `z.array(z.object({
  'provider': ${zstr},
  'models': z.array(z.object({
    'id': ${zstr},
    'name': ${nullable(zstr)},
  }).readonly()).readonly(),
}).readonly())`

const voidResult = `z.void()`
const nullOrRun = nullable(runView)

/** Method table: [method, mode, params, resultExpr]. */
const METHODS = [
  ['submit', undefined, [{ name: 'input', schema: submitInput }], runView],
  ['listRuns', undefined, [], runList],
  ['getRun', undefined, [{ name: 'runId', schema: zstr }], nullOrRun],
  ['watch', 'stream', [], runList],
  ['cancel', undefined, [{ name: 'runId', schema: zstr }], voidResult],
  ['apply', undefined, [{ name: 'runId', schema: zstr }, { name: 'hash', schema: zstr }], voidResult],
  ['discard', undefined, [{ name: 'runId', schema: zstr }], voidResult],
  ['listRoutes', undefined, [], routeCatalog],
]

const safe = (s) => s.replace(/[^a-zA-Z0-9_$]/g, '_')
const sym = (method, part) => `_${safe(`${PACKAGE}_${NAMESPACE}_${method}_${part}`)}$schema`

const schemaDecls = []
const descriptors = []

for (const [method, mode, params, resultExpr] of METHODS) {
  const paramDecls = params.map((param, index) => {
    const name = sym(method, `parameter_${index}`)
    schemaDecls.push([name, param.schema])
    return `        {
          name: '${param.name}',
          wire: '${param.name}',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '${PACKAGE}#${NAMESPACE}/${method}:${param.name}',
            create: ${name},
          },
        },`
  })
  const resultName = sym(method, 'result')
  schemaDecls.push([resultName, resultExpr])
  descriptors.push(`    {
      id: '${PACKAGE}#${NAMESPACE}/${method}',
      service: '${SERVICE}',
      namespace: '${NAMESPACE}',
      method: '${method}',${mode === 'stream' ? `\n      mode: 'stream',` : ''}
      invocation: { kind: 'direct' },
      parameters: [
${paramDecls.join('\n')}
      ],${params.some((p) => p.name === 'signal') || mode === 'stream' ? `\n      cancellation: { parameter: 'signal' },` : ''}
      result: {
        mode: 'strict',
        typeSymbol: '${PACKAGE}/types#${method === 'submit' || method === 'getRun' || method === 'listRuns' || method === 'watch' ? 'OrchestratorRunView' : method === 'listRoutes' ? 'OrchestratorRouteCatalog' : 'void'}',
        create: ${resultName},
      },
    },`)
}

const header = `/* Emitted by scripts/emit-typert.mjs — regenerating in-monorepo with\n * @deepseek-ai/dsh-typert-generator produces the equivalent artifacts. */\nimport { z } from 'zod'\n\n`

const schemaSource = schemaDecls.map(([name, expr]) =>
  `let ${name}$value\nconst ${name} = () => (${name}$value ??= ${expr})\n`,
).join('\n')

const hostFile = `${header}${schemaSource}
export const TYPERT = {
  package: '${PACKAGE}',
  face: 'host',
  schemas: [
  ],
  invocations: [
${descriptors.join('\n')}
  ],
  model: { services: [], events: [], objects: [] },
}
`

const clientFile = `${header}${schemaSource}
export const TYPERT_REMOTE = {
  package: '${PACKAGE}',
  descriptors: [
${descriptors.join('\n')}
  ],
}

export default TYPERT_REMOTE
`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/typert.host.js'), hostFile)
writeFileSync(join(root, 'lib/typert.remote-client.js'), clientFile)
writeFileSync(join(root, 'lib/typert.host.d.ts'), `export declare const TYPERT: {\n  package: string\n  face: string\n  schemas: unknown[]\n  invocations: unknown[]\n  model: unknown\n}\n`)
writeFileSync(join(root, 'lib/typert.remote-client.d.ts'), `declare const TYPERT_REMOTE: {\n  package: string\n  descriptors: unknown[]\n}\nexport { TYPERT_REMOTE }\nexport default TYPERT_REMOTE\n`)
console.log('emitted lib/typert.host.js + lib/typert.remote-client.js')
