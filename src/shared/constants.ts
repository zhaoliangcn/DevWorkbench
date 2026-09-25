// 工具箱工作区共享常量（来自 dev-tool-box）

export interface ToolboxModule {
  id: string
  name: string
  icon: string
  category: 'devtools' | 'network' | 'file' | 'system' | 'settings'
}

export const TOOLBOX_MODULES: ToolboxModule[] = [
  { id: 'json', name: 'JSON 工具', icon: '{}', category: 'devtools' },
  { id: 'url', name: 'URL 编解码', icon: '🔗', category: 'devtools' },
  { id: 'base64', name: 'Base64', icon: '🔐', category: 'devtools' },
  { id: 'codec', name: '高级编解码', icon: '🔀', category: 'devtools' },
  { id: 'baseconverter', name: '进制转换', icon: '🔢', category: 'devtools' },
  { id: 'timestamp', name: '时间戳', icon: '🕐', category: 'devtools' },
  { id: 'regex', name: '正则测试', icon: '.*', category: 'devtools' },
  { id: 'qrcode', name: '二维码', icon: '📱', category: 'devtools' },
  { id: 'crypto', name: '加密解密', icon: '🔒', category: 'devtools' },
  { id: 'difftool', name: '代码对比', icon: '📊', category: 'devtools' },
  { id: 'ip', name: 'IP工具箱', icon: '🌍', category: 'network' },
  { id: 'http', name: '接口调试', icon: '🌐', category: 'network' },
  { id: 'websocket', name: 'WebSocket', icon: '🔌', category: 'network' },
  { id: 'mockserver', name: 'Mock 服务', icon: '🎭', category: 'network' },
  { id: 'database', name: '数据库工具', icon: '🗄️', category: 'network' },
  { id: 'ssh', name: 'SSH 终端', icon: '💻', category: 'network' },
  { id: 'textprocess', name: '文本处理', icon: '📄', category: 'file' },
  { id: 'formatconverter', name: '格式互转', icon: '🔄', category: 'file' },
  { id: 'filehash', name: '文件哈希', icon: '#️⃣', category: 'file' },
  { id: 'system', name: '系统检测', icon: '🔍', category: 'system' },
  { id: 'password', name: '密码生成', icon: '🔑', category: 'system' },
  { id: 'calculator', name: '计算器', icon: '🧮', category: 'system' },
  { id: 'logviewer', name: '日志查看', icon: '📋', category: 'system' },
  { id: 'mirror', name: '镜像地址', icon: '🪞', category: 'system' },
  { id: 'imagetool', name: '图片工具', icon: '🖼️', category: 'file' },
  { id: 'snippets', name: '代码片段', icon: '📝', category: 'devtools' },
  { id: 'notes', name: '随手记', icon: '💡', category: 'devtools' },
]

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
