import { create } from 'zustand'

interface ToolboxStore {
  activeModule: string
  setActiveModule: (module: string) => void
}

export const useToolboxStore = create<ToolboxStore>((set) => ({
  activeModule: 'json',
  setActiveModule: (activeModule) => set({ activeModule }),
}))
