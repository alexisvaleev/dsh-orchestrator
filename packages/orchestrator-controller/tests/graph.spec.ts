import { describe, expect, it } from 'vitest'
import { attachValidator, buildGraph, cascadeSkipped, isSettled, readyNodes } from '../src/graph.ts'

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  prompt: `do ${id}`,
  ...extra,
})

describe('buildGraph', () => {
  it('builds a flat parallel graph', () => {
    const nodes = buildGraph({ tasks: [task('a'), task('b')] }, { maxNodes: 8, workerRoute: { provider: 'p', model: 'm' } })
    expect(nodes.size).toBe(2)
    expect(readyNodes(nodes).map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(nodes.get('a')!.route).toEqual({ provider: 'p', model: 'm' })
  })

  it('per-task routes win over the worker default', () => {
    const nodes = buildGraph({
      tasks: [task('a', { route: { provider: 'devin', model: 'devin-llm/swe-2' } })],
    }, { maxNodes: 8, workerRoute: { provider: 'deepseek' } })
    expect(nodes.get('a')!.route.provider).toBe('devin')
  })

  it('rejects duplicate ids, unknown deps, cycles, and oversize plans', () => {
    expect(() => buildGraph({ tasks: [task('a'), task('a')] }, { maxNodes: 8, workerRoute: {} })).toThrow('duplicate')
    expect(() => buildGraph({ tasks: [task('a', { deps: ['ghost'] })] }, { maxNodes: 8, workerRoute: {} })).toThrow('unknown')
    expect(() => buildGraph({ tasks: [task('a', { deps: ['b'] }), task('b', { deps: ['a'] })] }, { maxNodes: 8, workerRoute: {} })).toThrow('cycle')
    expect(() => buildGraph({ tasks: [task('a'), task('b')] }, { maxNodes: 1, workerRoute: {} })).toThrow('limit')
    expect(() => buildGraph({ tasks: [] }, { maxNodes: 8, workerRoute: {} })).toThrow('no tasks')
  })

  it('marks aggregate nodes with display parentage', () => {
    const nodes = buildGraph({
      tasks: [task('a'), task('agg', { kind: 'aggregate', deps: ['a'] })],
    }, { maxNodes: 8, workerRoute: {} })
    expect(nodes.get('agg')!.role).toBe('aggregate')
    expect(nodes.get('agg')!.parentId).toBe('a')
  })
})

describe('scheduling', () => {
  it('gates dependents on dep completion and cascades skips on failure', () => {
    const nodes = buildGraph({
      tasks: [task('a'), task('b', { deps: ['a'] }), task('c', { deps: ['b'] })],
    }, { maxNodes: 8, workerRoute: {} })
    attachValidator(nodes, {})
    expect(readyNodes(nodes).map((n) => n.id)).toEqual(['a'])

    nodes.get('a')!.status = 'failed'
    // One cascade call walks the transitive closure to a fixed point.
    expect(cascadeSkipped(nodes)).toEqual(['b', 'c'])
    expect(cascadeSkipped(nodes)).toEqual([])
    expect(nodes.get('c')!.status).toBe('skipped')
    // The validator waits for settled, not done — it still fires.
    expect(readyNodes(nodes).map((n) => n.id)).toEqual(['__validate__'])
    nodes.get('__validate__')!.status = 'done'
    expect(isSettled(nodes)).toBe(true)
  })

  it('keeps a pending dep-blocked node unready until deps complete', () => {
    const nodes = buildGraph({ tasks: [task('a'), task('b', { deps: ['a'] })] }, { maxNodes: 8, workerRoute: {} })
    nodes.get('a')!.status = 'running'
    expect(readyNodes(nodes).map((n) => n.id)).toEqual([])
    nodes.get('a')!.status = 'done'
    expect(readyNodes(nodes).map((n) => n.id)).toEqual(['b'])
  })
})
