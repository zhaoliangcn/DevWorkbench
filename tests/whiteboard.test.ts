// 附录 B.5.3：自实现 SVG 白板纯函数测试（pen 路径、序列化往返、命中、引用提取、base64）
import { describe, it, expect } from 'vitest'
import {
  penPath,
  parsePathD,
  simplify,
  elementsToSvg,
  svgToElements,
  hitTest,
  findSvgRefs,
  svgToBase64,
  base64ToSvg,
  newId,
  WB_W,
  WB_H,
  type WbElement,
} from '../src/workspaces/knowledge/utils/whiteboard'

const sampleElements = (): WbElement[] => [
  {
    id: 'e1',
    tool: 'pen',
    stroke: '#0090ff',
    strokeWidth: 2,
    points: [
      [10, 10],
      [50, 50],
      [90, 10],
    ],
  },
  { id: 'e2', tool: 'line', stroke: '#e5484d', strokeWidth: 4, x1: 0, y1: 0, x2: 100, y2: 40 },
  { id: 'e3', tool: 'arrow', stroke: '#30a46c', strokeWidth: 2, x1: 5, y1: 5, x2: 80, y2: 60 },
  { id: 'e4', tool: 'rect', stroke: '#f76b15', strokeWidth: 2, x: 20, y: 30, w: 120, h: 60 },
  { id: 'e5', tool: 'ellipse', stroke: '#8e4ec6', strokeWidth: 8, cx: 200, cy: 150, rx: 50, ry: 30 },
  {
    id: 'e6',
    tool: 'text',
    stroke: '#94a3b8',
    strokeWidth: 2,
    x: 40,
    y: 300,
    fontSize: 18,
    text: '你好 <b>& "世界"',
  },
]

describe('penPath / simplify / parsePathD（B.5.3）', () => {
  it('simplify 共线点折叠为两端点', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ]
    expect(simplify(pts)).toEqual([
      [0, 0],
      [30, 0],
    ])
  })

  it('simplify 拐点保留', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 20],
      [20, 0],
    ]
    expect(simplify(pts)).toEqual(pts)
  })

  it('simplify 两点原样返回', () => {
    const pts: [number, number][] = [
      [1, 2],
      [3, 4],
    ]
    expect(simplify(pts)).toEqual(pts)
  })

  it('penPath 生成 M 开头、共线输入退化为直线段（无 Q）', () => {
    const d = penPath([
      [0, 0],
      [30, 0],
      [60, 0],
    ])
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d).not.toContain('Q')
    expect(parsePathD(d)).toEqual([
      [0, 0],
      [60, 0],
    ])
  })

  it('parsePathD 对 Q 段取控制点（中点平滑保留的原锚点）、对 L 段取终点', () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [200, 100],
    ]
    const anchors = parsePathD(penPath(pts))
    expect(anchors[0]).toEqual([0, 0])
    expect(anchors[anchors.length - 1]).toEqual([200, 100])
  })

  it('penPath 空输入返回空串', () => {
    expect(penPath([])).toBe('')
  })
})

describe('elementsToSvg / svgToElements 序列化往返（B.5.3）', () => {
  it('各类元素逐字段往返无损', () => {
    const els = sampleElements()
    const parsed = svgToElements(elementsToSvg(els))
    expect(parsed).toEqual(els)
  })

  it('SVG 根为固定 1600x1000 viewBox', () => {
    const svg = elementsToSvg([])
    expect(svg).toContain(`viewBox="0 0 ${WB_W} ${WB_H}"`)
  })

  it('defs / marker 等无 data-wb-tool 的元素被解析忽略', () => {
    const svg = elementsToSvg(sampleElements())
    // defs 里的箭头 path 不应被当成 pen 元素
    const parsed = svgToElements(svg)
    expect(parsed).toHaveLength(6)
    expect(parsed.every((el) => el.id)).toBe(true)
  })

  it('外来杂散自闭合标签被忽略，text 转义往返', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="2" r="3"/><path d="M0,0 L1,1"/>' +
      '<text data-wb-tool="text" data-id="t1" x="1" y="2" font-size="12" fill="#fff">&lt;a&gt; &amp; &quot;b&quot;</text></svg>'
    const parsed = svgToElements(svg)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ tool: 'text', id: 't1', text: '<a> & "b"' })
  })

  it('元素几何属性解析缺失时回退默认值不抛错', () => {
    const parsed = svgToElements(
      '<svg><rect data-wb-tool="rect" data-id="r1"/></svg>'
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ tool: 'rect', x: 0, y: 0, w: 0, h: 0 })
  })

  it('newId 唯一且非空', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()))
    expect(ids.size).toBe(50)
  })
})

describe('hitTest 橡皮擦命中（B.5.3）', () => {
  const els = sampleElements()
  const [pen, line, arrow, rect, ellipse, text] = els

  it('pen：锚点附近命中，远处未命中', () => {
    expect(hitTest(pen, 10, 10, 4)).toBe(true)
    expect(hitTest(pen, 150, 150, 4)).toBe(false)
  })

  it('line / arrow：点到线段距离判定', () => {
    expect(hitTest(line, 50, 20, 3)).toBe(true)
    expect(hitTest(line, 50, 60, 3)).toBe(false)
    expect(hitTest(arrow, 40, 30, 3)).toBe(true)
    expect(hitTest(arrow, 0, 60, 3)).toBe(false)
  })

  it('rect：包围盒内命中（含边界余量）', () => {
    expect(hitTest(rect, 80, 60, 2)).toBe(true)
    expect(hitTest(rect, 10, 10, 2)).toBe(false)
  })

  it('ellipse：归一化椭圆内部命中', () => {
    expect(hitTest(ellipse, 200, 150, 2)).toBe(true)
    expect(hitTest(ellipse, 200, 190, 2)).toBe(false)
  })

  it('text：近似包围盒命中', () => {
    expect(hitTest(text, 45, 295, 2)).toBe(true)
    expect(hitTest(text, 45, 200, 2)).toBe(false)
  })
})

describe('findSvgRefs 笔记内附件引用提取（B.5.3）', () => {
  it('提取 attachments 下的 .svg 引用并去重保序', () => {
    const md = [
      '![白板](attachments/wb-a.svg)',
      '![img](attachments/pic.png)',
      '![重复](attachments/wb-a.svg)',
      '![根路径](other/wb-b.svg)',
      '![svg](assets/wb-c.svg)',
    ].join('\n')
    expect(findSvgRefs(md)).toEqual(['attachments/wb-a.svg'])
  })

  it('多引用按出现顺序返回', () => {
    const md = '![b](attachments/wb-b.svg)\n![a](attachments/wb-a.svg)'
    expect(findSvgRefs(md)).toEqual(['attachments/wb-b.svg', 'attachments/wb-a.svg'])
  })

  it('无引用返回空数组', () => {
    expect(findSvgRefs('普通文本 ![x](attachments/a.png)')).toEqual([])
  })
})

describe('svgToBase64 / base64ToSvg UTF-8 往返（B.5.3）', () => {
  it('含中文与特殊字符的 SVG 往返无损', () => {
    const svg = elementsToSvg(sampleElements())
    expect(base64ToSvg(svgToBase64(svg))).toBe(svg)
  })

  it('空串往返', () => {
    expect(base64ToSvg(svgToBase64(''))).toBe('')
  })
})
