/** Vitest alias for `@deepseek-ai/dsh-client-locale/client`: the published artifact is a ModuleLoader bundle. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-locale/client')).href)

const mod = (globalThis as { __ModuleLoader__: { modules: Map<string, Record<string, unknown>> } })
  .__ModuleLoader__.modules.get('@deepseek-ai/dsh-client-locale')!

export const apply = mod['apply']
export const inject = mod['inject']
export default mod
