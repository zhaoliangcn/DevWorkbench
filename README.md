# DevWorkbench

一站式开发者工作台（Electron 应用）：知识库管理 + AI 助手 + 开发工具箱。

## 功能

- **知识库**：Markdown 笔记管理、搜索、AI 文本操作（续写/扩写/纠错/摘要/格式化）
- **AI 助手**：嵌入 [dev-assistant-ts](https://github.com/zhaoliang/dev-assistant-ts) 的 Agent 能力——以知识库 Vault 为工作目录，支持文件读写、Glob/Grep、技能、定时任务；模型在设置页配置（Ollama / OpenAI / OpenAI 兼容）
- **开发工具**：SSH 终端、进程/端口管理、环境检测、数据管理
- **内置 API 服务**：Express 5，本地 127.0.0.1:3000

## 技术栈

Electron 39 + React 19 + TypeScript 6 + Vite 8 + Zustand + Express 5

## 快速开始

```bash
# 1. 安装依赖（dev-assistant-ts 以 git 依赖引入，npm 会自动拉取并构建）
npm install

# 2. 开发模式（Vite + Electron 同时启动）
npm run electron:start

# 3. 构建
npm run build

# 4. 打包桌面应用（需要 icons/ 下的应用图标）
npm run electron:build
```

## 脚本

| 脚本 | 说明 |
|---|---|
| `npm run dev` | 仅启动 Vite 渲染进程 |
| `npm run electron:dev` | 编译主进程 + preload 并启动 Electron |
| `npm run electron:start` | 开发模式（Vite + Electron） |
| `npm run build` | tsc + vite build |
| `npm run electron:build` | 构建并用 electron-builder 打包 |
| `npm run lint` | eslint |
| `npm run typecheck` | tsc -b --noEmit |

## 依赖说明

`dev-assistant-ts` 通过 git 依赖引入（见 `package.json`），指向其 GitHub 仓库；其 `prepare` 脚本在 `npm install` 时自动构建 dist，无需额外步骤。

## 许可证

[MIT](./LICENSE)
