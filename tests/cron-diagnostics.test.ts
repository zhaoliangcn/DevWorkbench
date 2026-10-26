// Cron 脚本失败诊断测试：识别 MSYS 版 python 把反斜杠 Windows 路径
// 当作 POSIX 相对路径的典型报错，并验证不误报正常错误
import { describe, it, expect } from 'vitest'
import { diagnoseScriptFailure } from '../electron/ipc/cron-diagnostics'

describe('diagnoseScriptFailure', () => {
  it('命中：MSYS python 反斜杠路径报错（用户实际案例）', () => {
    const reason =
      "python: can't open file '/d/share/DevWorkbench/release/win-unpacked/D:\\test\\zhaopin_spider.py': [Errno 2] No such file or directory"
    const hint = diagnoseScriptFailure(reason)
    expect(hint).toContain('MSYS 版 python')
    expect(hint).toContain('/d/test/zhaopin_spider.py')
    expect(hint).toContain('调整 PATH')
  })

  it('命中：单反斜杠形式（stderr 原文，非日志转义）', () => {
    const reason = "python: can't open file 'D:\\test\\a.py': [Errno 2] No such file or directory"
    expect(diagnoseScriptFailure(reason)).not.toBe('')
  })

  it('不命中：POSIX 路径报错（写法已正确，不给误导提示）', () => {
    const reason = "python: can't open file '/d/test/a.py': [Errno 2] No such file or directory"
    expect(diagnoseScriptFailure(reason)).toBe('')
  })

  it('不命中：非文件类错误', () => {
    expect(diagnoseScriptFailure('Command failed: something went wrong')).toBe('')
    expect(diagnoseScriptFailure('')).toBe('')
  })

  it("不命中：can't open file 但无路径引号段", () => {
    expect(diagnoseScriptFailure("python: can't open file: [Errno 2]")).toBe('')
  })
})
