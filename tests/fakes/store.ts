/** Minimal createSnapshotStore matching `@deepseek-ai/dsh-client-store`'s contract for tests. */
export function createSnapshotStore<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    set: (value: T) => {
      snapshot = value
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
