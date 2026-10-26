// Cron 本地脚本失败诊断（纯函数，零依赖，供单测）。
//
// 场景：应用以 GUI 启动时继承系统 PATH，若用户为运行 msys64 git 而将
// C:\msys64\usr\bin 置前，`python`/`bash` 会解析到 MSYS 版二进制。
// MSYS 工具按 POSIX 语义（分隔符 /）解释参数，把 D:\test\x.py 视作
// 相对路径拼在 cwd 后，报错形如：
//   can't open file '/<cwd>/D:\test\x.py': [Errno 2] No such file or directory
// 这类问题无法在执行器内安全地自动改写命令（会误伤正则/内嵌源码中的反斜杠），
// 故仅做模式识别并给出可操作的修复指引。

const PATTERN = /can't open file '([^']+)'/

export function diagnoseScriptFailure(reason: string): string {
  const m = reason.match(PATTERN)
  if (!m || !m[1].includes('\\')) return ''
  return (
    '。诊断：报错来自 MSYS 版 python（PATH 中 msys64\\usr\\bin 优先），它把反斜杠 Windows 路径当作 POSIX 相对路径。' +
    '修复任选其一：① 调整 PATH 使原生 python（如 conda/官方安装版）优先，命令无需修改；' +
    '② 脚本路径改写为 POSIX 形式，如 /d/test/zhaopin_spider.py'
  )
}
