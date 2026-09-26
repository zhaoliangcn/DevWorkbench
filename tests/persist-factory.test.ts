import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createPersistedStore } from '../src/store/createPersistedStore'

/** node 环境无 localStorage（persist 依赖）：stub 为内存 Map，便于断言落盘内容 */
const storage = new Map<string, string>()

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
})

interface DemoState {
  count: number
  setCount: (n: number) => void
}

describe('createPersistedStore（附录 D P3 store 工厂）', () => {
  it('persist key 使用统一前缀 devworkbench-，且状态变化正常落盘', () => {
    const useDemo = createPersistedStore<DemoState>(
      (set) => ({ count: 0, setCount: (count) => set({ count }) }),
      { name: 'demo' },
    )
    useDemo.getState().setCount(3)

    expect(storage.has('devworkbench-demo')).toBe(true)
    const persisted = JSON.parse(storage.get('devworkbench-demo') ?? '{}')
    expect(persisted.state.count).toBe(3)
    expect(useDemo.getState().count).toBe(3)
  })

  it('partialize 只落盘指定字段', () => {
    const useDemo = createPersistedStore<DemoState & { temp: string }>(
      (set) => ({ count: 0, setCount: (count) => set({ count }), temp: '', }),
      { name: 'partial', partialize: (s) => ({ count: s.count }) },
    )
    useDemo.getState().setCount(7)

    const persisted = JSON.parse(storage.get('devworkbench-partial') ?? '{}')
    expect(persisted.state.count).toBe(7)
    expect(persisted.state.temp).toBeUndefined()
  })

  it('旧版本数据经 migrate 转换后并入 store（同步 storage 水合同步完成）', () => {
    storage.set(
      'devworkbench-mig',
      JSON.stringify({ state: { count: 2 }, version: 0 }),
    )
    const useDemo = createPersistedStore<DemoState>(
      (set) => ({ count: 0, setCount: (count) => set({ count }) }),
      {
        name: 'mig',
        version: 1,
        migrate: (persisted) => ({
          count: ((persisted as { count?: number }).count ?? 0) * 10,
        }),
      },
    )

    expect(useDemo.getState().count).toBe(20)
  })
})
