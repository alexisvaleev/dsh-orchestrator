import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const modules = new Map<string, unknown>()

Object.assign(globalThis.window ?? globalThis, {
  __ModuleLoader__: {
    modules,
    load: ({ id, factory }: { id: string, factory: (req: typeof require) => unknown }) => {
      modules.set(id, factory(require))
    },
  },
})
