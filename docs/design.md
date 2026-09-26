# DevWorkbench 设计文档

> **项目名称**: DevWorkbench（开发者工作台）
> **appId**: `com.devworkbench.app`
> **定位**: 一站式开发者工作台，融合知识库管理与开发工具箱
> **来源**: 合并 dev-tool-box（工具箱）与 my-obsidian（知识库）两个项目，保留全部功能

---

## 1. 目标

### 1.1 核心目标

- 将 dev-tool-box 的 28 个开发工具与 my-obsidian 的知识库功能合并为单一桌面应用
- 统一技术栈，消除版本碎片（Electron 39 / React 19 / Vite 8 / ESM）
- 两个工作区可通过顶层导航无缝切换

### 1.2 非目标

- 不做云同步 / 多端协作（保留 my-obsidian 已有的本地 REST API 即可）
- 不做插件系统（保持单体应用，工具以源码形式集成）
- 不做在线版 / Web 版

---

## 2. 技术栈

| 层 | 选型 | 来源 | 说明 |
|----|------|------|------|
| 桌面框架 | Electron 39 | my-obsidian | 最新稳定版 |
| 前端框架 | React 19 | my-obsidian | |
| 构建工具 | Vite 8 | my-obsidian | |
| 语言 | TypeScript 6 | my-obsidian | 严格模式 |
| 模块系统 | ESM | my-obsidian | dev-tool-box 需从 CJS 迁移 |
| 状态管理 | Zustand 5 | 两项目均使用 | |
| Markdown 渲染 | marked 18 | my-obsidian | |
| 图表可视化 | d3 7 | my-obsidian | GraphView / MindMapView |
| 图标库 | lucide-react | my-obsidian | 统一图标体系 |
| 代码编辑器 | Monaco Editor | dev-tool-box | |
| 终端模拟 | @xterm/xterm 6 | dev-tool-box | SSH 终端 |
| SSH 客户端 | node-ssh | dev-tool-box | |
| 加密库 | crypto-js | dev-tool-box | |
| HTTP 服务器 | express 5 | 两项目均使用 | API Server |
| 二维码 | qrcode + jsqr | dev-tool-box | |
| WebSocket | ws 8 | dev-tool-box | WebSocket 调试工具 |

### 关键依赖 ESM 兼容性风险

以下 dev-tool-box 依赖需要验证 ESM 兼容性：

| 依赖 | 风险等级 | 验证方式 |
|------|---------|---------|
| node-ssh | 高 | `import { NodeSSH } from 'node-ssh'` 在 ESM 下能否正常加载 |
| @xterm/xterm | 低 | v6 原生支持 ESM |
| @monaco-editor/react | 低 | 已支持 ESM |
| monaco-editor | 中 | Vite 需配置 worker 处理 |
| crypto-js | 低 | v4.2 支持 ESM |
| ws | 中 | Node 内置模块，主进程使用 |

---

## 3. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │
│  │  IPC Router  │  │  API Server  │  │  System Services            │ │
│  │  (namespaced)│  │  (Express)   │  │  (SSH / Port / Env / etc.)  │ │
│  └─────────────┘  └──────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ IPC
┌─────────────────────────────────────────────────────────────────────┐
│                        Preload (contextBridge)                      │
│  vault.*  file.*  dir.*  ssh.*  system.*  data.*  http.*  ...      │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ contextBridge
┌─────────────────────────────────────────────────────────────────────┐
│                        Renderer (React 19)                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              TopNavigation (Workspace Switch)                │  │
│  │     [🏠 知识库]    [🧰 开发者工具]    [⚙️ 设置]             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  KnowledgeWorkspace │  │  ToolboxWorkspace                    │ │
│  │                     │  │                                      │ │
│  │  ┌──┐ ┌──────────┐ │  │  ┌──────┐ ┌────────────────────────┐│ │
│  │  │  │ │  Editor  │ │  │  │ Side │ │  Tool Content          ││ │
│  │  │Fi│ │          │ │  │  │ bar  │ │                        ││ │
│  │  │le│ │ Markdown │ │  │  │      │ │  (JSON/SSH/HTTP/...)  ││ │
│  │  │Ex│ │ Preview  │ │  │  │ Cats │ │                        ││ │
│  │  │pl│ │ Split    │ │  │  │      │ │                        ││ │
│  │  │  │ │          │ │  │  │      │ │                        ││ │
│  │  │  │ └──────────┘ │  │  └──────┘ └────────────────────────┘│ │
│  │  │  │  RightPanel   │  │                                      │ │
│  │  │  │  Backlinks    │  │                                      │ │
│  │  │  │  Tags/Search  │  │                                      │ │
│  │  │  │  Graph/AI     │  │                                      │ │
│  │  └──┘               │  │                                      │ │
│  └─────────────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 工作区切换

两个工作区是互斥的视图，同一时刻只显示一个。切换时：

- 知识库工作区保持其内部状态（当前笔记、编辑模式、面板状态）
- 工具箱工作区保持其内部状态（当前选中的工具、工具内数据）
- 两者通过 Zustand store 分别管理，互不干扰

---

## 4. 目录结构

```
devworkbench/
├── electron/                      # Electron 主进程
│   ├── main.ts                    # 主窗口创建 + 生命周期
│   ├── preload.ts                 # contextBridge 暴露 API
│   ├── ipc/                       # IPC handlers（按命名空间分文件）
│   │   ├── vault.ts               # vault:* 知识库路径管理
│   │   ├── file.ts                # file:* 文件读写
│   │   ├── dir.ts                 # dir:* 目录管理
│   │   ├── ssh.ts                 # ssh:* SSH 连接/执行/Shell
│   │   ├── system.ts              # system:* 环境检测/端口/进程
│   │   ├── data.ts                # data:* 本地数据持久化
│   │   └── index.ts              # 统一注册入口
│   ├── api-server.ts              # Express REST API（来自 my-obsidian）
│   └── api-config.ts             # API 配置管理
├── src/                           # Renderer（React）
│   ├── App.tsx                    # 根组件 + 工作区路由
│   ├── main.tsx                   # React 入口
│   ├── shared/                    # 跨工作区共享
│   │   ├── constants.ts           # 模块定义、默认配置
│   │   ├── components/            # 通用组件（ThemeToggle 等）
│   │   └── hooks/                 # 通用 hooks
│   ├── store/                     # Zustand stores
│   │   ├── appStore.ts            # 全局状态（主题、字体、活跃工作区）
│   │   ├── knowledgeStore.ts      # 知识库状态（来自 my-obsidian）
│   │   └── toolboxStore.ts       # 工具箱状态（来自 dev-tool-box）
│   ├── workspaces/
│   │   ├── knowledge/             # 知识库工作区
│   │   │   ├── KnowledgeWorkspace.tsx
│   │   │   ├── components/
│   │   │   │   ├── FileExplorer.tsx
│   │   │   │   ├── MarkdownEditor.tsx
│   │   │   │   ├── RightPanel.tsx
│   │   │   │   ├── SettingsPanel.tsx
│   │   │   │   ├── VaultGate.tsx
│   │   │   │   └── Sidebar.tsx
│   │   │   ├── panels/
│   │   │   │   ├── BacklinksPanel.tsx
│   │   │   │   ├── SearchPanel.tsx
│   │   │   │   ├── TagsPanel.tsx
│   │   │   │   ├── GraphView.tsx
│   │   │   │   ├── MindMapView.tsx
│   │   │   │   └── AiPanel.tsx
│   │   │   └── utils/
│   │   │       ├── markdown.ts
│   │   │       ├── filesystem.ts
│   │   │       ├── ai.ts
│   │   │       ├── export.ts
│   │   │       └── mindmap.ts
│   │   └── toolbox/              # 开发者工具工作区
│   │       ├── ToolboxWorkspace.tsx
│   │       ├── Sidebar.tsx
│   │       ├── ModuleContent.tsx
│   │       └── tools/
│   │           ├── Base64Tool.tsx
│   │           ├── BaseConverterTool.tsx
│   │           ├── CodecTool.tsx
│   │           ├── CryptoTool.tsx
│   │           ├── DatabaseTool.tsx
│   │           ├── DiffTool.tsx
│   │           ├── FileHashTool.tsx
│   │           ├── FormatConverterTool.tsx
│   │           ├── HttpModule.tsx
│   │           ├── ImageTool.tsx
│   │           ├── IpTool.tsx
│   │           ├── JsonTool.tsx
│   │           ├── LogViewerTool.tsx
│   │           ├── MirrorTool.tsx
│   │           ├── MockServerTool.tsx
│   │           ├── PasswordGeneratorTool.tsx
│   │           ├── ProgrammerCalculatorTool.tsx
│   │           ├── QrCodeTool.tsx
│   │           ├── RegexTool.tsx
│   │           ├── SSHModule.tsx
│   │           ├── SnippetsModule.tsx
│   │           ├── SystemModule.tsx
│   │           ├── TextProcessTool.tsx
│   │           ├── TimestampTool.tsx
│   │           ├── UrlTool.tsx
│   │           └── WebSocketTool.tsx
│   ├── types/
│   │   ├── index.ts              # 知识库类型（Note/Folder/Link/...）
│   │   └── toolbox.ts            # 工具箱类型（SSHConfig/Snippet/...）
│   ├── styles/
│   │   └── global.css
│   └── index.css
├── public/
│   ├── icons.svg
│   └── favicon.svg
├── icons/                        # 应用图标
├── docs/
│   └── design.md                # 本文档
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.electron.json
├── tsconfig.preload.json
├── tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
└── .gitignore
```

---

## 5. 功能清单

### 5.1 知识库工作区（来自 my-obsidian）

| 功能 | 组件 | 说明 |
|------|------|------|
| Vault 管理 | VaultGate | 选择/创建知识库文件夹 |
| 文件树 | FileExplorer | 树形展示笔记和文件夹 |
| Markdown 编辑器 | MarkdownEditor | 编辑/预览/分屏三种模式 |
| Wiki 链接 | markdown.ts | `[[笔记名]]` 双向链接 |
| 反向链接 | BacklinksPanel | 查看哪些笔记引用当前笔记 |
| 标签系统 | TagsPanel | `#标签` 组织笔记 |
| 全局搜索 | SearchPanel | 标题/内容/标签全文搜索 |
| 知识图谱 | GraphView | d3 力导向图可视化笔记关系 |
| 思维导图 | MindMapView | 从 Markdown 标题结构生成思维导图 |
| AI 助手 | AiPanel | Ollama/OpenAI 接入，续写/扩写/总结 |
| 导出 | export.ts | 导出为 .md / .docx / .pdf |
| REST API | api-server.ts | Express 服务，外部应用可通过 API 操作笔记 |

### 5.2 开发者工具工作区（来自 dev-tool-box）

| 分类 | 工具 | 组件 | 说明 |
|------|------|------|------|
| 开发工具 | JSON 格式化 | JsonTool | 格式化/压缩/校验 |
| | URL 编解码 | UrlTool | encode/decode |
| | Base64 | Base64Tool | 编解码 |
| | 高级编解码 | CodecTool | Hex/UTF-8/GBK 等 |
| | 进制转换 | BaseConverterTool | 2/8/10/16 互转 |
| | 时间戳 | TimestampTool | Unix 时间戳转换 |
| | 正则测试 | RegexTool | 实时匹配高亮 |
| | 二维码 | QrCodeTool | 生成/解析 |
| | 加密解密 | CryptoTool | AES/DES/RSA/MD5/SHA |
| | 代码对比 | DiffTool | 文本 diff |
| | 代码片段 | SnippetsModule | 分类管理代码片段 |
| 网络 | IP 工具箱 | IpTool | 子网计算/掩码/分类 |
| | 接口调试 | HttpModule | HTTP 请求发送 |
| | WebSocket | WebSocketTool | WS 连接调试 |
| | Mock 服务 | MockServerTool | 本地 Mock API |
| | 数据库工具 | DatabaseTool | 数据库连接查询 |
| | SSH 终端 | SSHModule | xterm 远程终端 |
| 文件 | 文本处理 | TextProcessTool | 大小写/去重/排序 |
| | 格式互转 | FormatConverterTool | JSON/XML/YAML/TOML |
| | 文件哈希 | FileHashTool | MD5/SHA256 计算 |
| | 图片工具 | ImageTool | 压缩/格式转换/Base64 |
| 系统 | 系统检测 | SystemModule | 环境检测/端口扫描 |
| | 密码生成 | PasswordGeneratorTool | 可配置规则 |
| | 计算器 | ProgrammerCalculatorTool | 程序员计算器 |
| | 日志查看 | LogViewerTool | 大文件日志 |
| | 镜像地址 | MirrorTool | npm/pip/docker 镜像检测 |

### 5.3 功能重叠处理

| 重叠功能 | dev-tool-box | my-obsidian | 决策 |
|---------|-------------|-------------|------|
| 笔记功能 | NotesModule（简单文本存储） | 完整 Vault + Markdown 编辑 | 废弃 NotesModule，统一用知识库 |
| AI 助手 | AITool（基础对话） | AiPanel（续写/扩写/总结/格式化） | 保留 AiPanel，吸收 AITool 的通用对话能力 |
| 代码片段 | SnippetsModule（分类管理） | 无 | 保留 SnippetsModule，可作为知识库的补充 |
| 设置 | SettingsModule | SettingsPanel | 合并为统一设置页，覆盖主题/字体/终端/AI/ API |

---

## 6. IPC 设计

### 6.1 命名空间规范

所有 IPC channel 使用 `namespace:action` 格式，避免冲突：

| 命名空间 | 来源 | 示例 |
|---------|------|------|
| `vault:*` | my-obsidian | `vault:getPath`, `vault:select` |
| `file:*` | my-obsidian | `file:read`, `file:write`, `file:delete`, `file:list` |
| `dir:*` | my-obsidian | `dir:list`, `dir:create`, `dir:delete` |
| `ssh:*` | dev-tool-box | `ssh:connect`, `ssh:exec`, `ssh:openShell` |
| `system:*` | dev-tool-box | `system:checkEnv`, `system:checkPort`, `system:killProcess` |
| `data:*` | dev-tool-box | `data:save`, `data:load`, `data:delete` |
| `app:*` | 新增 | `app:getVersion`, `app:getPlatform` |

### 6.2 冲突处理

dev-tool-box 原有 IPC 名称无前缀（如 `get-app-version`、`check-env`），需统一加前缀：

| 旧名称 | 新名称 |
|--------|--------|
| `get-app-version` | `app:getVersion` |
| `check-env` | `system:checkEnv` |
| `check-port` | `system:checkPort` |
| `kill-process` | `system:killProcess` |
| `save-data` | `data:save` |
| `load-data` | `data:load` |
| `delete-data` | `data:delete` |
| `get-platform` | `app:getPlatform` |
| `check-mirror` | `system:checkMirror` |
| `ssh-connect` | `ssh:connect` |
| `ssh-disconnect` | `ssh:disconnect` |
| `ssh-exec` | `ssh:exec` |
| `ssh-open-shell` | `ssh:openShell` |
| `ssh-shell-write` | `ssh:shellWrite` |
| `ssh-shell-resize` | `ssh:shellResize` |
| `ssh-shell-data` (event) | `ssh:shellData` |
| `ssh-shell-error` (event) | `ssh:shellError` |
| `ssh-shell-close` (event) | `ssh:shellClose` |

### 6.3 Preload API 结构

```typescript
// electron/preload.ts
const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
  vault: {
    getPath: () => ipcRenderer.invoke('vault:getPath'),
    getName: () => ipcRenderer.invoke('vault:getName'),
    select: () => ipcRenderer.invoke('vault:select'),
  },
  file: {
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    delete: (path: string) => ipcRenderer.invoke('file:delete', path),
    list: () => ipcRenderer.invoke('file:list'),
    export: (path: string, content: string) => ipcRenderer.invoke('file:export', path, content),
  },
  dir: {
    list: () => ipcRenderer.invoke('dir:list'),
    create: (path: string) => ipcRenderer.invoke('dir:create', path),
    delete: (path: string) => ipcRenderer.invoke('dir:delete', path),
  },
  ssh: {
    connect: (id: string, config: SSHConfig) => ipcRenderer.invoke('ssh:connect', id, config),
    disconnect: (id: string) => ipcRenderer.invoke('ssh:disconnect', id),
    exec: (id: string, command: string) => ipcRenderer.invoke('ssh:exec', id, command),
    openShell: (id: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:openShell', id, cols, rows),
    shellWrite: (id: string, data: string) => ipcRenderer.invoke('ssh:shellWrite', id, data),
    shellResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:shellResize', id, cols, rows),
    onShellData: (id: string, cb: (data: string) => void) => { /* ... */ },
    onShellError: (id: string, cb: (err: string) => void) => { /* ... */ },
    onShellClose: (id: string, cb: () => void) => { /* ... */ },
  },
  system: {
    checkEnv: (env: string) => ipcRenderer.invoke('system:checkEnv', env),
    checkPort: (port: number) => ipcRenderer.invoke('system:checkPort', port),
    killProcess: (pid: number) => ipcRenderer.invoke('system:killProcess', pid),
    checkMirror: (url: string) => ipcRenderer.invoke('system:checkMirror', url),
  },
  data: {
    save: (key: string, data: unknown) => ipcRenderer.invoke('data:save', key, data),
    load: (key: string) => ipcRenderer.invoke('data:load', key),
    delete: (key: string) => ipcRenderer.invoke('data:delete', key),
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
```

---

## 7. 状态管理

### 7.1 Store 分层

```
appStore (全局)
  ├── activeWorkspace: 'knowledge' | 'toolbox' | 'settings'
  ├── theme: 'light' | 'dark'
  ├── fontSize: number
  └── (persisted to userData)

knowledgeStore (知识库)
  ├── notes: Record<string, Note>
  ├── folders: Folder[]
  ├── activeNoteId: string | null
  ├── vaultName: string | null
  ├── aiConfig: AiConfig
  └── (persisted to localStorage + vault files)

toolboxStore (工具箱)
  ├── activeTool: string
  ├── sshConnections: SSHConfig[]
  ├── snippets: SnippetCategory[]
  ├── httpRequests: RequestCollection[]
  └── (persisted to userData via data:* IPC)
```

### 7.2 全局 Store 接口

```typescript
interface AppStore {
  activeWorkspace: 'knowledge' | 'toolbox' | 'settings'
  setActiveWorkspace: (ws: 'knowledge' | 'toolbox' | 'settings') => void

  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => Promise<void>

  fontSize: number
  setFontSize: (size: number) => Promise<void>

  cursorBlink: boolean  // 终端光标闪烁
  setCursorBlink: (blink: boolean) => Promise<void>

  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
}
```

---

## 8. UI 设计

### 8.1 顶层导航

```
┌───────────────────────────────────────────────────────────────────────┐
│ DevWorkbench                  [🏠 知识库] [🧰 开发工具] [⚙️ 设置]    │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│                    (当前工作区内容)                                    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

- 顶层导航固定在顶部，高度约 48px
- 使用 lucide-react 图标 + 文字标签
- 当前激活的工作区高亮显示

### 8.2 知识库工作区布局

保持 my-obsidian 原有布局不变：

```
┌──────────┬──────────────────────────┬──────────────┐
│          │                          │              │
│  File    │  ┌────────────────────┐  │  RightPanel  │
│  Explorer│  │                    │  │              │
│          │  │  MarkdownEditor    │  │  Backlinks   │
│  + Folder│  │  (edit/preview/   │  │  Tags        │
│    Tree  │  │   split)           │  │  Search      │
│          │  │                    │  │  Graph       │
│          │  └────────────────────┘  │  MindMap     │
│          │                          │  AI          │
│          │                          │              │
└──────────┴──────────────────────────┴──────────────┘
```

### 8.3 工具箱工作区布局

保持 dev-tool-box 原有布局不变：

```
┌──────────┬───────────────────────────────────────────┐
│          │                                           │
│ Sidebar  │  ┌─────────────────────────────────────┐  │
│          │  │                                     │  │
│ 开发工具  │  │  Tool Content                      │  │
│  JSON    │  │                                     │  │
│  Base64  │  │  (当前选中工具的界面)                │  │
│  ...     │  │                                     │  │
│          │  │                                     │  │
│ 网络调试  │  │                                     │  │
│  HTTP    │  │                                     │  │
│  SSH     │  │                                     │  │
│  ...     │  │                                     │  │
│          │  └─────────────────────────────────────┘  │
│ 系统工具  │                                           │
│          │  ┌─────────────────────────────────────┐  │
│          │  │ 状态栏: v1.0.0  |  2026-09-24       │  │
│          │  └─────────────────────────────────────┘  │
└──────────┴───────────────────────────────────────────┘
```

### 8.4 主题系统

- 沿用 my-obsidian 的 `light` / `dark` 主题机制
- CSS 变量定义在 `global.css`，两个工作区共享
- dev-tool-box 的 `ModuleCommon.css` / `ToolCommon.css` 需适配 CSS 变量

---

## 9. 构建配置

### 9.1 package.json 关键配置

```json
{
  "name": "devworkbench",
  "version": "1.0.0",
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "electron:dev": "tsc -p tsconfig.preload.json && tsc -p tsconfig.electron.json && NODE_ENV=development electron dist-electron/main.js --no-sandbox",
    "electron:start": "concurrently -k \"npm run dev\" \"sleep 2 && npm run electron:dev\"",
    "build": "tsc -b && vite build",
    "electron:build": "npm run build && tsc -p tsconfig.electron.json && tsc -p tsconfig.preload.json && electron-builder",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "build": {
    "appId": "com.devworkbench.app",
    "productName": "DevWorkbench",
    "directories": { "output": "release" },
    "files": ["dist/**/*", "dist-electron/**/*"],
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["zip", "dmg"]
    },
    "win": { "target": "nsis" },
    "linux": { "target": "AppImage" }
  }
}
```

### 9.2 TypeScript 配置

采用 my-obsidian 的多 tsconfig 方案：

| 文件 | 用途 | module | 输出 |
|------|------|--------|------|
| `tsconfig.json` | 根引用 | - | 无 |
| `tsconfig.app.json` | Renderer 源码 | esnext | noEmit (Vite 处理) |
| `tsconfig.electron.json` | 主进程 | esnext | dist-electron/ |
| `tsconfig.preload.json` | Preload | commonjs | dist-electron/ |
| `tsconfig.node.json` | Node 工具脚本 | esnext | - |

### 9.3 Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // Monaco Editor worker 配置
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco': ['monaco-editor', '@monaco-editor/react'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit'],
          'd3': ['d3'],
        },
      },
    },
  },
})
```

---

## 10. 迁移计划

### Phase 1: 项目骨架（最小可运行）

**目标**: 新项目能启动，显示空白窗口 + 顶层导航

- [ ] 初始化 package.json（合并两个项目的依赖）
- [ ] 配置 tsconfig（5 个文件）
- [ ] 配置 vite.config.ts
- [ ] 配置 eslint
- [ ] 编写 electron/main.ts（基础窗口创建）
- [ ] 编写 electron/preload.ts（空 API 桩）
- [ ] 编写 src/App.tsx + src/main.tsx（顶层导航 + 工作区占位）
- [ ] 编写 src/store/appStore.ts
- [ ] 验证: `npm run electron:start` 能打开窗口

### Phase 2: 知识库工作区迁移

**目标**: 知识库功能完整可用

- [ ] 迁移 electron/ipc/vault.ts + file.ts + dir.ts
- [ ] 迁移 electron/api-server.ts + api-config.ts
- [ ] 迁移 electron/preload.ts 的 vault/file/dir 部分
- [ ] 迁移 src/workspaces/knowledge/ 全部组件
- [ ] 迁移 src/store/knowledgeStore.ts
- [ ] 迁移 src/types/index.ts（知识库类型）
- [ ] 迁移 utils（markdown/filesystem/ai/export/mindmap）
- [ ] 适配 import 路径和 ESM 语法
- [ ] 验证: 知识库工作区可创建/编辑/搜索笔记，图谱和思维导图正常

### Phase 3: 工具箱工作区迁移（高优先工具）

**目标**: 核心开发工具可用

- [ ] 迁移 electron/ipc/ssh.ts + system.ts + data.ts
- [ ] 迁移 electron/preload.ts 的 ssh/system/data 部分
- [ ] 迁移 src/workspaces/toolbox/Sidebar + ModuleContent
- [ ] 迁移 src/store/toolboxStore.ts
- [ ] 迁移 src/types/toolbox.ts
- [ ] 逐个迁移高优先工具:
  - [ ] JsonTool, Base64Tool, UrlTool, CodecTool
  - [ ] CryptoTool, RegexTool, TimestampTool, BaseConverterTool
  - [ ] QrCodeTool, DiffTool, PasswordGeneratorTool
  - [ ] HttpModule, WebSocketTool, MockServerTool
  - [ ] SSHModule（含 xterm 集成）
- [ ] 验证: 每个工具可独立使用，SSH 终端可连接

### Phase 4: 工具箱工作区迁移（剩余工具）

**目标**: 全部工具迁移完成

- [ ] 迁移剩余工具:
  - [ ] DatabaseTool, IpTool, MirrorTool
  - [ ] SystemModule, LogViewerTool, ProgrammerCalculatorTool
  - [ ] TextProcessTool, FormatConverterTool, FileHashTool, ImageTool
  - [ ] SnippetsModule
- [ ] 废弃 NotesModule（功能已被知识库工作区覆盖）
- [ ] 合并 AITool 到知识库的 AiPanel
- [ ] 验证: 全部 28 个工具列表可用

### Phase 5: 收尾

**目标**: 可发布

- [ ] 统一设置页（主题/字体/终端/AI/API Server）
- [ ] 应用图标生成（icns + ico）
- [ ] CSS 变量统一，两个工作区视觉一致
- [ ] electron-builder 打包测试（macOS dmg + Windows nsis）
- [ ] 清理冗余文件和依赖

---

## 11. 技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| node-ssh ESM 兼容 | SSH 功能不可用 | Phase 3 前先写最小验证；必要时用 dynamic import |
| Monaco Editor Vite worker | 代码编辑器白屏 | 配置 `optimizeDeps` + `manualChunks`；必要时用 CDN worker |
| CSS 冲突 | 布局错乱 | 每个工作区用独立 CSS 文件 + CSS 变量层；避免全局选择器 |
| IPC 命名迁移遗漏 | 工具调用失败 | 迁移时用 grep 全局搜索旧名称，逐一替换 |
| 包体积过大 | 安装包 >300MB | Monaco/d3/xterm 按需加载；asar 打包 |
| Zustand v4→v5 API 变更 | Store 行为异常 | 迁移时检查 persist 中间件用法 |

---

## 12. 合并后依赖完整清单

### dependencies

```
# 知识库（来自 my-obsidian）
react ^19.2.5
react-dom ^19.2.5
zustand ^5.0.12
marked ^18.0.3
d3 ^7.9.0
lucide-react ^1.14.0
uuid ^14.0.0
docx ^9.6.1
html2pdf.js ^0.14.0
cors ^2.8.6
express ^5.2.1

# 工具箱（来自 dev-tool-box）
@monaco-editor/react ^4.6.0
monaco-editor ^0.44.0
@xterm/xterm ^6.0.0
@xterm/addon-fit ^0.11.0
node-ssh ^13.2.1
crypto-js ^4.2.0
qrcode ^1.5.3
jsqr ^1.4.0
ws ^8.21.0
axios ^1.6.0
react-router-dom ^6.20.0  (评估是否可移除，改用 Zustand 状态切换)
```

### devDependencies

```
# 来自 my-obsidian（较新版本）
@vitejs/plugin-react ^6.0.1
vite ^8.0.10
typescript ~6.0.2
electron ^39.2.7
electron-builder ^26.0.12
concurrently ^9.2.1
eslint ^10.2.1
@eslint/js ^10.0.1
typescript-eslint ^8.58.2
eslint-plugin-react-hooks ^7.1.1
eslint-plugin-react-refresh ^0.5.2
globals ^17.5.0
tsx ^4.21.0

# 来自 dev-tool-box（类型定义）
@types/crypto-js ^4.2.2
@types/qrcode ^1.5.6
@types/node ^24.12.2
@types/react ^19.2.14
@types/react-dom ^19.2.3
@types/cors ^2.8.19
@types/express ^5.0.6
@types/d3 ^7.4.3
@types/uuid ^10.0.0
```

---

## 附录 A: 两个项目技术栈差异速查

| 维度 | dev-tool-box | my-obsidian | DevWorkbench |
|------|-------------|-------------|-------------|
| Electron | 27 | 39 | 39 |
| React | 18 | 19 | 19 |
| Vite | 5 | 8 | 8 |
| TypeScript | 5 | 6 | 6 |
| 模块系统 | CJS | ESM | ESM |
| Zustand | 4 | 5 | 5 |
| Electron Builder | 24 | 26 | 26 |
| @vitejs/plugin-react | 4 | 6 | 6 |

---

## 附录 B: 可集成功能清单（演进路线）

> 本附录记录 DevWorkbench 后续可集成的功能方向，作为演进路线参考。所有方向均坚持本地优先、单体源码集成，不引入云同步与插件系统（对齐 §1.2 非目标）。

### B.1 核心方向：三工作区联动（差异化护城河）

DevWorkbench 区别于 DevToys、Postman、Obsidian 单品的护城河，在于「知识库 + 工具箱 + AI Agent 同处一个进程」。详见附录 C。

- 工具箱输出 → 一键存入知识库
- AI Agent 调用工具箱纯函数能力
- 全局捕获中心（Capture Inbox）

### B.2 工作台骨架

| 功能 | 说明 |
|------|------|
| 全局命令面板（Cmd/Ctrl+K） | 跨三域搜索：笔记/工具/Agent 历史/片段，回车即跳转 |
| Git 工作区 | isomorphic-git 或系统 git，status/diff/commit/branch/log；Vault 文件天然适合版本管理 |
| 多标签文件编辑器 | 复用 Monaco，打开 Vault/SSH 远端/临时草稿，统一知识库编辑器与代码编辑器 |
| 剪贴板历史管理器 | 按类型智能预览（JSON/URL/Base64/代码），SnippetsModule 的自然延伸 |

### B.3 AI Agent 能力显性化

当前 `assistant.ts` 已埋设 `schedulerEnabled`、`approvalEnabled` 开关但 UI 未暴露。

| 功能 | 说明 |
|------|------|
| 定时任务看板 | 查看/创建/暂停/删除定时任务、运行日志、失败重试 |
| 工具调用审批墙 | `approvalEnabled` 显性化，危险工具挂起待批准/拒绝 |
| Agent 技能编辑器 | 用 Markdown 写技能 prompt 存入 Vault，挂载工具集 |
| 会话历史与分支 | 持久化会话、按笔记分支、跨会话检索（参考 dsh Trajectory） |

### B.4 数据与服务层（网络分类缺口）

| 功能 | 说明 |
|------|------|
| API 集合 + 环境变量 | Postman-lite：命名环境、`{{var}}` 插值、断言、链式请求 |
| Webhook 接收器 | 复用 Express 3000 端口，加 `/webhook/*` 路由，实时展示请求 |
| 通用 Cron 可视化 | 触发 HTTP/本地脚本/Agent 任务，复用 Express + 主进程定时器 |
| Redis 客户端 + SQLite 浏览器 | 扩展 DatabaseTool，补 Redis 与 SQLite 文件直开 |

### B.5 知识库深度功能（my-obsidian 血统延伸）

| 功能 | 说明 |
|------|------|
| 每日笔记 + 模板系统 | 每日生成 `YYYY-MM-DD.md`，模板变量 `{{date}}`/`{{yesterday}}` |
| 看板视图 / 日历视图 | 复用 d3（GraphView/MindMapView 同套可视化哲学） |
| Excalidraw 白板 | 手绘图存为笔记附件，形成三种可视化 |
| 间隔重复（Anki 化） | 笔记转闪卡，本地调度复习 |

### B.6 DevOps 与系统监控

| 功能 | 说明 |
|------|------|
| Docker 管理面板 | 本地 docker socket，容器/镜像/日志 |
| 进程监视器 | 实时进程列表、CPU/内存排序、一键 kill（延伸 system:killProcess） |
| 环境变量 / .env 管理器 | 多文件对比、缺失检测、生成 docker-compose 环境段 |

### B.7 安全与隐私

| 功能 | 说明 |
|------|------|
| 凭据保险库 | 主进程级加密存储（crypto-js），SSH/HTTP/DB 配置按引用取用 |
| 笔记加密 | 单篇或整个 Vault 加密（本地密钥），crypto-js 已在依赖 |

### B.8 优先级建议

| 优先级 | 功能 | 理由 |
|--------|------|------|
| ★★★ | 工具箱→知识库 + Agent 调工具箱 | 三工作区联动，别家做不到 |
| ★★★ | 全局命令面板 | 低成本高频，让工作台名副其实 |
| ★★★ | 定时任务看板 + 审批墙 | 显性化已埋设的 Agent 能力 |
| ★★☆ | Git 工作区 + 多标签编辑器 | 开发者骨架，契合 Vault 文件模型 |
| ★★☆ | API 环境变量 + Webhook 接收器 | Express 已在跑，边际成本低 |
| ★☆☆ | 每日笔记/模板/看板 | my-obsidian 血统的自然续作 |

---

## 附录 C: 三工作区联动详细设计

> 本附录给出「打通知识库 / 工具箱 / AI 助手三个工作区」的工程方案，落到具体文件、函数与类型。

### C.1 现状诊断：为什么现在联动不起来

1. **三个 store 互相不可见**：`appStore` 只管当前工作区；`knowledgeStore`（导出为 `useStore`）、`toolboxStore`、`assistantStore` 各自独立，无共享层。
2. **Assistant workingDir 被焊死**：`electron/ipc/assistant.ts` 中 `workingDir = getVaultPath()`，Agent 只能看到 Vault。
3. **工具是 UI 组件不是函数**：`ModuleContent.tsx` 用 `moduleMap` 把字符串映射到 React 组件，逻辑封装在组件内部，外部与 Agent 无法调用。
4. **切换工作区即销毁状态**：`App.tsx` 条件渲染卸载组件，仅靠 Zustand store 在组件外存状态才未丢失中间产物。

核心对策：**新建一个跨工作区的共享总线层**。

### C.2 链路一：工具箱输出 → 知识库

#### 拼图
- 工具箱组件内部有输出状态（JSON 格式化结果、HTTP 响应、SSH 日志…）
- 知识库已有 `importNote(title, content, folderPath?)`，可直接落笔记、自动去重、写文件、抽标签

#### 设计：三层

**① 新建 `src/store/crossStore.ts` — 跨工作区共享总线**

只存「在途的、跨域的」瞬态数据，不持久化（避免与各域 store 冲突）：

```typescript
import { create } from 'zustand'

export interface Carry {
  id: string
  source: 'toolbox' | 'assistant' | 'knowledge' | 'capture'
  kind: 'text' | 'json' | 'http-response' | 'ssh-log' | 'db-result' | 'image' | 'note-ref'
  title: string
  content: string
  meta?: Record<string, unknown>
  createdAt: number
}

interface CrossState {
  carry: Carry | null
  setCarry: (c: Carry | null) => void
  recentLinks: Array<{ from: string; to: string; ts: number }>
  pushLink: (from: string, to: string) => void
}
```

单槽 + 历史，符合「带过去就落地」的心智模型。

**② 新建 `src/shared/hooks/useSaveToVault.ts` — 复用动作**

```typescript
export function useSaveToVault() {
  return useCallback(async (carry: Omit<Carry, 'id' | 'createdAt' | 'source'>) => {
    const full: Carry = { ...carry, id: crypto.randomUUID(), source: 'toolbox', createdAt: Date.now() }
    useCrossStore.getState().setCarry(full)
    useAppStore.getState().setActiveWorkspace('knowledge')
  }, [])
}
```

**③ 工具组件侧：注入 `<SaveToVaultButton />`**

挂在 `module-content` 容器层而非每个工具内部，无需改 26 个工具组件。获取当前工具输出的两种方案：

| 方案 | 做法 | 评价 |
|------|------|------|
| A. 工具约定 | 每个工具通过 `useToolboxStore.setOutput()` 上抛 | 改 26 个组件，工作量大 |
| B. 复制即捕获 | 浮动按钮读取当前激活 DOM 区域 `textarea`/`pre`/`.output` 的值 | 零侵入，先跑起来 |

推荐先做 B，高价值工具（JSON/HTTP/DB）后续升级到 A。

**④ 知识库侧：落地面板**

`KnowledgeWorkspace.tsx` 顶层 `useEffect` 监听 `carry`：

```typescript
useEffect(() => {
  const c = useCrossStore.getState().carry
  if (c?.source === 'toolbox') setLandingOpen(true)
}, [carry])
```

落地浮层提供：标题（默认工具名+时间戳）、目标文件夹（下拉 `getFolderTree()`）、是否追加 frontmatter（`#工具/{kind}`）、预览。确认后调 `importNote`，再 `setCarry(null)` 清槽。

### C.3 链路二：AI Agent 调用工具箱能力

#### 关键洞察：别让 Agent 调 UI 组件，让它调纯函数

工具箱核心逻辑多为 `string → string`，可抽离。

#### 阶段 1：抽取工具纯函数（不改 Agent）

新建 `src/workspaces/toolbox/tools/pure/` 目录：

```typescript
// src/workspaces/toolbox/tools/pure/base64.ts
export interface Base64Input  { text: string; op: 'encode' | 'decode' }
export interface Base64Output { result: string; error?: string }
export function base64Transform(input: Base64Input): Base64Output { /* ... */ }
```

候选（按纯函数化难度排序）：Base64、进制转换、时间戳、URL 编解码、文件哈希、正则匹配、格式互转、加密解密。

此步零风险：现有组件改为调用纯函数，UI 行为不变，逻辑被「解封」。

#### 阶段 2：注册成 Agent 工具契约

主进程新建 `electron/ipc/assistant-tools.ts`：

```typescript
export function buildToolboxToolContract(name: string) {
  switch (name) {
    case 'base64': return {
      description: 'Base64 编解码',
      parameters: { text: 'string', op: '"encode"|"decode"' },
      execute: (args) => base64Transform(args),
    }
  }
}
```

`preload.ts` 的 `assistant.start` options 增加 `extraToolNames?: string[]`；`assistant.ts` 在现有 `disabledTools` 做减法之外，新增 `extraTools` 通道做加法。

#### 完整调用链

```
用户输入「把这段 Base64 解码并存成笔记」
  → assistant:run(message)
  → 主进程 Agent 循环
  → Agent 调 base64 工具契约（纯函数，主进程同步执行）
  → Agent 调 file:write 写入 Vault
  → assistant:events 广播 toolCall/toolResult
  → 渲染端流式渲染
```

此链路在一个 Agent 任务里串起三工作区：工具箱（纯函数）→ Agent（编排）→ 知识库（落地）。

#### 安全边界（呼应 dsh 借鉴）

`assistant.ts` 现有 `DEFAULT_DISABLED_TOOLS` 之外，新增三段式清单（存于 data IPC）：

```
auto-allow:      [base64, url, timestamp, ...]    # 自动放行
needs-approval:  [file:write, file:delete]        # 挂起，UI 审批
disabled:        [exec_command, run_hook, ssh:*]   # 禁用
```

审批触发时 `assistant:events` 发 `approvalRequest`，`AssistantWorkspace.tsx` 渲染「批准/拒绝」按钮，把焊死的 `approvalEnabled: false` 变成可控边界。

### C.4 链路三：全局捕获中心（Capture Inbox）

快捷键唤起的浮层，不占工作区 tab，作为三工作区统一入口。

#### 组件结构

```
App.tsx
  ├─ <TopNav />              (已有)
  ├─ <WorkspaceBody />       (已有，条件渲染)
  ├─ <CapturePalette />      ← 新增，Cmd/Ctrl+Shift+K 唤起
  └─ <CarryIndicator />      ← 新增，右下角徽章，显示当前 carry
```

#### 四种去向

| 去向 | 动作 |
|------|------|
| 存为笔记 | `setCarry({source:'capture', ...})` → 跳知识库 → 落地浮层 |
| 喂给 Agent | `setCarry(...)` → 跳助手 → 自动填入输入框 |
| 跑工具 | 识别内容（JSON/Base64/URL/时间戳）→ 自动选工具 → 跳工具箱 → 自动填入 |
| 存为代码片段 | 调 `data:save` 写入 SnippetsModule 存储 |

#### 智能识别（复用 C.3 纯函数）

```typescript
function detectKind(text: string): Carry['kind'] {
  if (/^\s*[\{\[]/.test(text)) return 'json'
  if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0) return 'base64'
  if (/^https?:\/\//.test(text)) return 'url'
  if (/^\d{10}$/.test(text)) return 'timestamp'
  return 'text'
}
```

检测器 = Agent 工具契约 = 工具箱 UI 逻辑，三者同源，体现打通的复利。

### C.5 链路四：知识库 → Agent 上下文

#### 现状
`AssistantWorkspace.tsx` 输入框是裸的，Agent workingDir 是 Vault 能读所有笔记，但用户无法指定「这次对话基于哪篇笔记」。

#### 设计：笔记上下文钉选

`knowledgeStore` 增加 `pinnedForAssistant: string[]`；`MarkdownEditor` 顶部加「📌 钉到助手」按钮；`AssistantWorkspace` 顶部显示已钉笔记 chip，发送时拼入消息：

```typescript
const handleSend = async () => {
  const pinned = useKnowledgeStore.getState().pinnedForAssistant
  const context = pinned.length
    ? `【基于以下笔记回答】\n${pinned.map(id => notes[id].path).join('\n')}\n\n${text}`
    : text
  await assistantAPI.run(context)
}
```

最小侵入：不碰 `assistant.ts` 主进程逻辑，仅通过消息文本传递信号，Agent 用已有 `file:read` 读取。

进阶版（后续）在 `assistant:run` 加 `contextFiles: string[]` 参数，主进程注入 system prompt，比文本拼接更干净。

### C.6 改动落点清单（按依赖顺序）

| 顺序 | 文件 | 改动 | 链路 |
|------|------|------|------|
| 1 | 新建 `src/store/crossStore.ts` | 跨工作区总线（carry + recentLinks） | 一、三 |
| 2 | 新建 `src/shared/hooks/useSaveToVault.ts` | 装载 carry + 跳工作区 | 一 |
| 3 | 新建 `src/workspaces/knowledge/components/CarryLanding.tsx` | 知识库落地浮层 | 一 |
| 4 | `KnowledgeWorkspace.tsx` | 挂载落地浮层 + 监听 carry | 一 |
| 5 | `ModuleContent.tsx` | 容器层加 `<SaveToVaultButton />` | 一 |
| 6 | `App.tsx` | 顶层挂 `<CapturePalette />` + `<CarryIndicator />` | 三 |
| 7 | 新建 `src/workspaces/toolbox/tools/pure/*.ts` | 抽取工具纯函数 | 二、三 |
| 8 | `ModuleContent.tsx` | 工具组件改用纯函数（渐进） | 二 |
| 9 | 新建 `electron/ipc/assistant-tools.ts` | 纯函数→Agent 工具契约 | 二 |
| 10 | `electron/preload.ts` | `assistant.start` 加 `extraToolNames` | 二 |
| 11 | `electron/ipc/assistant.ts` | 注入 extraTools + 三段式权限清单 | 二 |
| 12 | `AssistantWorkspace.tsx` | 渲染审批事件 + 钉选笔记 chip | 二、四 |
| 13 | `knowledgeStore.ts` | 加 `pinnedForAssistant` + 钉选方法 | 四 |
| 14 | `MarkdownEditor.tsx` | 「钉到助手」按钮 | 四 |

### C.7 推荐实施切片（MVP 顺序）

每一片独立交付价值：

- **切片 A（1-5）**：工具箱→知识库联动。最直观，用户立刻感知「工具产物进了笔记」。
- **切片 B（7-8 部分 + 9-11）**：Agent 调工具箱。先接 3 个纯函数工具（base64/时间戳/json 格式化），验证契约链路再扩。
- **切片 C（6 + Capture）**：全局捕获中心。复用 A、B 的 carry 与纯函数。
- **切片 D（12-14）**：知识库→Agent 钉选 + 审批墙 UI。

切片 A 完成即有「别家没有的第一条联动链路」；四片全做完，三工作区成为有机的「开发者工作台」。

### C.8 dsh 借鉴映射

本附录的设计部分受 DeepSeek Harness（dsh，2026 年 8 月开源）范式启发：

| DevWorkbench 联动设计 | 对应 dsh 概念 | 借鉴形态 |
|----------------------|--------------|----------|
| 会话历史与分支 | Trajectory append-only 事件流 + fork | 持久化 trajectory + 分轨查看 + fork 重跑 |
| 审批墙 | approval + 沙箱契约 | 三段式权限清单 + 挂起审批 |
| Agent 调工具箱 | Tool Contract 强类型契约 | TS 契约暴露纯函数工具 |
| 技能编辑器 / 模式 | skills 插件 + Creator 模式 | 组合工具集+prompt 存预设 |

区别：dsh 是 Web/CLI 的 Agent 运行时；DevWorkbench 是 Electron 本地工作台，且多了「知识库+工具箱」这一 dsh 没有的差异化地基，不做完整插件系统（对齐 §1.2）。
