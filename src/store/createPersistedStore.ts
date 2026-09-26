import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * persist store 工厂（附录 D P3 扩展点）：统一 persist key 前缀 + version/migrate 约定。
 * P3 仅提供钩子、不改变运行时行为 —— 现有 store（appStore / assistantStore / knowledgeStore）
 * 渐进迁移：迁移时保持 options.name 与旧 key 后半段一致即可沿用既有数据
 * （注意 knowledgeStore 旧 key 'my-obsidian-storage' 不符合前缀约定，迁移需单独处理）。
 */

/** 统一 key 前缀：'devworkbench-<name>'（现有 devworkbench-app / devworkbench-assistant 已符合） */
const PERSIST_KEY_PREFIX = 'devworkbench-'

interface CreatePersistedStoreOptions<T> {
  /** key 后半段（自动加 'devworkbench-' 前缀） */
  name: string
  /** 存储版本，缺省 1 */
  version?: number
  /** 版本迁移：读到的旧版本持久化数据经此转换后并入 store */
  migrate?: (persisted: unknown, version: number) => Partial<T>
  /** 选择性持久化（缺省全量持久化） */
  partialize?: (state: T) => Partial<T>
}

/**
 * initializer 类型：zustand 5.0.15 的 Persist 签名中 initializer 的 mutator 槽位
 * 固定为 ['zustand/persist', unknown]，U 只作用于 PersistOptions 与返回 store 的
 * persist API —— 故此处槽位用 unknown（写成 Partial<T> 反而不兼容 setOptions 逆变）。
 */
type PersistedCreator<T> = StateCreator<T, [['zustand/persist', unknown]], []>

export function createPersistedStore<T extends object>(
  initializer: PersistedCreator<T>,
  options: CreatePersistedStoreOptions<T>,
) {
  return create<T>()(
    // 显式 U=Partial<T>：泛型工厂边界处让 zustand 跳过推断（否则 T 与 Partial<T> 推断冲突）
    persist<T, [], [], Partial<T>>(
      initializer,
      {
        name: `${PERSIST_KEY_PREFIX}${options.name}`,
        version: options.version ?? 1,
        storage: createJSONStorage(() => localStorage),
        ...(options.partialize ? { partialize: options.partialize } : {}),
        ...(options.migrate ? { migrate: options.migrate } : {}),
      },
    ),
  )
}
