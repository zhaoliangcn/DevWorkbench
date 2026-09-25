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
