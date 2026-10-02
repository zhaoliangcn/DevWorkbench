// SMB 共享管理测试：渲染层解析纯函数 + 主进程校验/配置纯函数
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {} }))

import {
  parseWindowsNetShare,
  parseLinuxSmbConf,
  parseMacSharingList,
  parseShareList,
  suggestName,
  isHiddenShare,
} from '../src/workspaces/toolbox/tools/pure/smb'
import {
  isSafeShareName,
  isSafeAccountName,
  isSafeSharePath,
  removeSmbConfSection,
  buildSmbConfEntry,
  decodeWindowsText,
} from '../electron/ipc/smb'

const NET_SHARE_CN = `
共享名       资源                        备注

-------------------------------------------------------------------------------
ADMIN$       C:\\Windows                  远程管理
IPC$                                     远程 IPC
devshare     D:\\share\\proj
命令成功完成。
`

const NET_SHARE_EN = `

Share name   Resource                        Remark

-------------------------------------------------------------------------------
ADMIN$       C:\\Windows                      Remote Admin
devshare     D:\\share\\proj                  team vault
The command completed successfully.
`

describe('parseWindowsNetShare', () => {
  it('解析中文系统 net share 表格（按列位置切分资源/备注）', () => {
    const rows = parseWindowsNetShare(NET_SHARE_CN)
    expect(rows.map((r) => r.name)).toEqual(['ADMIN$', 'IPC$', 'devshare'])
    expect(rows[0].path).toBe('C:\\Windows')
    expect(rows[0].remark).toBe('远程管理')
    expect(rows[1].path).toBe('')
    expect(rows[1].remark).toBe('远程 IPC')
    expect(rows[2].path).toBe('D:\\share\\proj')
    expect(rows[2].remark).toBe('')
  })

  it('解析英文系统 net share 表格（备注含空格）', () => {
    const rows = parseWindowsNetShare(NET_SHARE_EN)
    expect(rows).toHaveLength(2)
    expect(rows[1].path).toBe('D:\\share\\proj')
    expect(rows[1].remark).toBe('team vault')
  })

  it('空输入返回空数组', () => {
    expect(parseWindowsNetShare('')).toEqual([])
  })
})

describe('decodeWindowsText（OEM 代码页解码）', () => {
  it('936/GBK 正确解码中文备注', () => {
    // "默认共享" 的 GBK 编码
    const buf = Buffer.from([0xc4, 0xac, 0xc8, 0xcf, 0xb9, 0xb2, 0xcf, 0xed])
    expect(decodeWindowsText(buf, 936)).toBe('默认共享')
  })

  it('未知代码页回退 utf8（ASCII 无损）', () => {
    const buf = Buffer.from('Default share', 'utf-8')
    expect(decodeWindowsText(buf, 437)).toBe('Default share')
  })

  it('空 Buffer 返回空串', () => {
    expect(decodeWindowsText(Buffer.alloc(0), 936)).toBe('')
    expect(decodeWindowsText(undefined, 936)).toBe('')
  })
})

describe('parseLinuxSmbConf', () => {
  const CONF = `[global]
   workgroup = WORKGROUP

[homes]
   comment = Home Dirs
   browseable = no

[devshare]
   path = /srv/devshare
   comment = team vault
   writable = yes

[printers]
   path = /var/spool/samba
`

  it('解析共享段并跳过 global/homes/printers', () => {
    const rows = parseLinuxSmbConf(CONF)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ name: 'devshare', path: '/srv/devshare', remark: 'team vault' })
  })

  it('无 path 的段保留为空路径', () => {
    const rows = parseLinuxSmbConf('[myshare]\n   writable = yes\n')
    expect(rows).toEqual([{ name: 'myshare', path: '', remark: '' }])
  })

  it('文件尾共享段不丢失', () => {
    const rows = parseLinuxSmbConf('[a]\n  path = /a\n')
    expect(rows).toHaveLength(1)
  })
})

describe('parseMacSharingList', () => {
  it('解析 name:/path: 成对记录', () => {
    const raw = `List of Share Points

name:\tMusic
path:\t/Users/joe/Music

name:\tproj
path:\t/Users/joe/proj
`
    const rows = parseMacSharingList(raw)
    expect(rows).toEqual([
      { name: 'Music', path: '/Users/joe/Music', remark: '' },
      { name: 'proj', path: '/Users/joe/proj', remark: '' },
    ])
  })
})

describe('parseShareList 跨平台分发', () => {
  it('按 platform 选择解析器', () => {
    expect(parseShareList(NET_SHARE_CN, 'win32')).toHaveLength(3)
    expect(parseShareList('[a]\npath=/a\n', 'linux')).toHaveLength(1)
    expect(parseShareList('name:\tx\npath:\t/x\n', 'darwin')).toHaveLength(1)
    expect(parseShareList('anything', 'unknown')).toEqual([])
  })
})

describe('isHiddenShare / suggestName', () => {
  it('系统共享以 $ 结尾', () => {
    expect(isHiddenShare('ADMIN$')).toBe(true)
    expect(isHiddenShare('devshare')).toBe(false)
  })

  it('suggestName 取 basename 并清洗非法字符', () => {
    expect(suggestName('D:\\share\\shared-proj')).toBe('shared-proj')
    expect(suggestName('/srv/team vault/')).toBe('team-vault')
    expect(suggestName('')).toBe('')
  })
})

describe('isSafeShareName / isSafeAccountName（防注入）', () => {
  it('合法共享名通过', () => {
    expect(isSafeShareName('devshare')).toBe(true)
    expect(isSafeShareName('a1_b-c.d')).toBe(true)
  })

  it('非法共享名拒绝：空串、注入字符、超长、特殊字符开头', () => {
    expect(isSafeShareName('')).toBe(false)
    expect(isSafeShareName('-bad')).toBe(false)
    expect(isSafeShareName('a&calc')).toBe(false)
    expect(isSafeShareName('a;b')).toBe(false)
    expect(isSafeShareName('a'.repeat(81))).toBe(false)
  })

  it('账户名允许字母数字与空格点横线', () => {
    expect(isSafeAccountName('Everyone')).toBe(true)
    expect(isSafeAccountName('Authenticated Users')).toBe(true)
    expect(isSafeAccountName('u1;calc')).toBe(false)
  })
})

describe('isSafeSharePath', () => {
  it('合法绝对路径通过', () => {
    expect(isSafeSharePath('D:\\share\\proj')).toBe(true)
    expect(isSafeSharePath('/srv/devshare')).toBe(true)
    expect(isSafeSharePath('\\\\server\\share')).toBe(true)
  })

  it('相对路径与含引号路径拒绝', () => {
    expect(isSafeSharePath('relative/path')).toBe(false)
    expect(isSafeSharePath('D:\\fo"o')).toBe(false)
    expect(isSafeSharePath("D:\\fo'o")).toBe(false)
  })

  it('系统敏感目录拒绝', () => {
    expect(isSafeSharePath('C:\\Windows\\System32')).toBe(false)
    expect(isSafeSharePath('C:\\Windows')).toBe(false)
    expect(isSafeSharePath('/etc')).toBe(false)
    expect(isSafeSharePath('/usr/local/share')).toBe(false)
  })
})

describe('removeSmbConfSection', () => {
  const CONF = `[global]
   workgroup = WORKGROUP

[devshare]
   path = /srv/devshare
   writable = yes

[keepme]
   path = /srv/keep
`

  it('移除目标段，保留其余段', () => {
    const next = removeSmbConfSection(CONF, 'devshare')
    expect(next).not.toContain('[devshare]')
    expect(next).toContain('[global]')
    expect(next).toContain('[keepme]')
  })

  it('段不存在时原文返回', () => {
    expect(removeSmbConfSection(CONF, 'nope')).toBe(CONF)
  })

  it('目标段为文件尾段时正确移除', () => {
    const next = removeSmbConfSection(CONF, 'keepme')
    expect(next).not.toContain('[keepme]')
    expect(next).toContain('[devshare]')
  })
})

describe('buildSmbConfEntry', () => {
  it('读写 + guest 缺省', () => {
    const entry = buildSmbConfEntry('devshare', '/srv/devshare', 'team', false, undefined)
    expect(entry).toContain('[devshare]')
    expect(entry).toContain('path = /srv/devshare')
    expect(entry).toContain('writable = yes')
    expect(entry).toContain('guest ok = yes')
    expect(entry).not.toContain('valid users')
  })

  it('只读 + 指定账户', () => {
    const entry = buildSmbConfEntry('devshare', '/srv/devshare', undefined, true, 'alice')
    expect(entry).toContain('read only = yes')
    expect(entry).toContain('valid users = alice')
    expect(entry).not.toContain('guest ok')
  })

  it('remark 中的换行被折叠为空格', () => {
    const entry = buildSmbConfEntry('a', '/a', 'line1\nline2', false, undefined)
    expect(entry).not.toContain('\nline2')
    expect(entry).toContain('line1 line2')
  })
})
