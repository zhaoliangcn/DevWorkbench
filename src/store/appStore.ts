import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Workspace = 'knowledge' | 'assistant' | 'toolbox' | 'settings'
export type Theme = 'light' | 'dark'

interface AppStore {
  activeWorkspace: Workspace
  setActiveWorkspace: (ws: Workspace) => void

  theme: Theme
  setTheme: (theme: Theme) => void

  fontSize: number
  setFontSize: (size: number) => void

  cursorBlink: boolean
  setCursorBlink: (blink: boolean) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeWorkspace: 'knowledge',
      setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),

      theme: 'light',
      setTheme: (theme) => set({ theme }),

      fontSize: 16,
      setFontSize: (fontSize) => set({ fontSize }),

      cursorBlink: true,
      setCursorBlink: (cursorBlink) => set({ cursorBlink }),
    }),
    {
      name: 'devworkbench-app',
      partialize: (state) => ({
        activeWorkspace: state.activeWorkspace,
        theme: state.theme,
        fontSize: state.fontSize,
        cursorBlink: state.cursorBlink,
      }),
    },
  ),
)
