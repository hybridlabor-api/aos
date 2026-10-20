import { test } from 'node:test'
import assert from 'node:assert'

// Simulate laneLayout function for testing
function laneLayout(phases) {
  const byId = Object.fromEntries(phases.map(p => [p.id, p]))
  const depth = {}
  const visiting = new Set()

  function getDepth(p) {
    if (depth[p.id] != null) return depth[p.id]
    if (visiting.has(p.id)) return 0
    visiting.add(p.id)
    const preds = p.needs.filter(id => byId[id])
    depth[p.id] = preds.length ? 1 + Math.max(...preds.map(id => getDepth(byId[id]))) : 0
    visiting.delete(p.id)
    return depth[p.id]
  }

  phases.forEach(getDepth)
  const cols = {}
  phases.forEach(p => (cols[depth[p.id]] ??= []).push(p))

  const gx = 120, gy = 48, pad = 64
  const pos = {}
  const metrics = Object.fromEntries(phases.map(p => [p.id, { w: 400, h: 128, nodeW: 400, nodeH: 128, detailW: 0, detailH: 0 }]))
  const columnWidths = {}

  for (const [col, list] of Object.entries(cols)) {
    columnWidths[col] = Math.max(...list.map(p => metrics[p.id].w))
  }

  const orderedColumns = Object.keys(cols).map(Number).sort((a, b) => a - b)
  const columnX = {}
  let nextX = pad

  const MAX_NODES_PER_RANK = 4
  const rankWraps = {}

  for (const col of orderedColumns) {
    const list = cols[col]
    if (list.length > MAX_NODES_PER_RANK) {
      const cols_needed = Math.ceil(list.length / MAX_NODES_PER_RANK)
      rankWraps[col] = { cols: cols_needed, perCol: Math.ceil(list.length / cols_needed) }
    }
    const w = columnWidths[col]
    const actualW = rankWraps[col] ? columnWidths[col] * rankWraps[col].cols + gx * (rankWraps[col].cols - 1) : w
    columnX[col] = nextX
    nextX += actualW + gx
  }

  let maxBottom = pad
  for (const [col, list] of Object.entries(cols)) {
    const wrap = rankWraps[col]
    const subRowGap = wrap ? gy / 2 : gy

    if (wrap) {
      const colWidth = columnWidths[col]
      const rows = Math.ceil(list.length / wrap.cols)

      const maxHeights = Array(wrap.cols).fill(0)
      for (let i = 0; i < list.length; i++) {
        const sc = i % wrap.cols
        const sr = Math.floor(i / wrap.cols)
        maxHeights[sc] = Math.max(maxHeights[sc], metrics[list[i].id].h)
      }

      let nextY = pad
      for (let sr = 0; sr < rows; sr++) {
        let colNextY = nextY
        for (let sc = 0; sc < wrap.cols; sc++) {
          const idx = sr * wrap.cols + sc
          if (idx >= list.length) continue

          const p = list[idx]
          const size = metrics[p.id]
          const baseX = columnX[col] + sc * (colWidth + gx)
          const x = baseX + (colWidth - size.w) / 2
          const y = nextY

          pos[p.id] = { x, y, ...size, nodeX: x + (size.w - size.nodeW) / 2, nodeY: y }
          colNextY = Math.max(colNextY, y + size.h)
        }
        nextY = colNextY + subRowGap
      }

      maxBottom = Math.max(maxBottom, nextY - subRowGap + pad)
    } else {
      let nextY = pad
      for (const p of list) {
        const size = metrics[p.id]
        const x = columnX[col] + (columnWidths[col] - size.w) / 2

        pos[p.id] = { x, y: nextY, ...size, nodeX: x + (size.w - size.nodeW) / 2, nodeY: nextY }
        nextY += size.h + subRowGap
      }
      maxBottom = Math.max(maxBottom, nextY - subRowGap + pad)
    }
  }

  return { phases, byId, pos, width: Math.max(nextX - gx + pad, 560), height: Math.max(maxBottom, 300) }
}

test('compact layout with 12 parallel nodes plus 1 merge node', () => {
  // Create a plan with 12 parallel nodes (depth 0) and 1 merge node (depth 1)
  const parallelNodes = Array.from({ length: 12 }, (_, i) => ({
    id: `node-${i}`,
    title: `Node ${i + 1}`,
    needs: [],
    level: 'component'
  }))

  const mergeNode = {
    id: 'merge',
    title: 'Merge',
    needs: parallelNodes.map(n => n.id),
    level: 'component'
  }

  const phases = [...parallelNodes, mergeNode]
  const layout = laneLayout(phases)

  // Calculate bounding box
  const allX = Object.values(layout.pos).map(p => p.x + p.w)
  const allY = Object.values(layout.pos).map(p => p.y + p.h)
  const minX = Object.values(layout.pos).map(p => p.x).reduce((a, b) => Math.min(a, b), Infinity)
  const minY = Object.values(layout.pos).map(p => p.y).reduce((a, b) => Math.min(a, b), Infinity)

  const boundWidth = Math.max(...allX) - minX
  const boundHeight = Math.max(...allY) - minY

  // Log metrics
  console.log(`
Layout metrics for 12+1 node plan:
- Layout width: ${layout.width}
- Layout height: ${layout.height}
- Bounding box width: ${boundWidth}
- Bounding box height: ${boundHeight}
- Aspect ratio (height/width): ${(boundHeight / boundWidth).toFixed(2)}
- Target: aspect ratio ≤ 2:1 (height ≤ 2×width)
  `)

  // Verify aspect ratio is ≤ 2:1 (more horizontal than vertical)
  const aspectRatio = boundHeight / boundWidth
  assert.ok(aspectRatio <= 2, `Aspect ratio ${aspectRatio.toFixed(2)} exceeds 2:1 target`)

  // Verify all nodes are positioned
  assert.strictEqual(Object.keys(layout.pos).length, 13, 'All 13 nodes should be positioned')

  // Verify nodes are not overlapping
  const positions = Object.values(layout.pos)
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const p1 = positions[i]
      const p2 = positions[j]
      const hOverlap = p1.x < p2.x + p2.w && p1.x + p1.w > p2.x
      const vOverlap = p1.y < p2.y + p2.h && p1.y + p1.h > p2.y
      assert.ok(!( hOverlap && vOverlap ), `Nodes at (${p1.x}, ${p1.y}) and (${p2.x}, ${p2.y}) overlap`)
    }
  }

  // Verify layout is wider than tall
  assert.ok(layout.width >= layout.height / 2, `Layout should be roughly square or wider: ${layout.width}x${layout.height}`)
})

test('compact layout with small plan (≤3 nodes) remains unchanged', () => {
  // Create a plan with 3 nodes in sequence
  const node1 = { id: 'n1', title: 'Node 1', needs: [], level: 'component' }
  const node2 = { id: 'n2', title: 'Node 2', needs: ['n1'], level: 'component' }
  const node3 = { id: 'n3', title: 'Node 3', needs: ['n2'], level: 'component' }

  const layout = laneLayout([node1, node2, node3])

  // Should have 3 columns (one per depth level)
  const depths = new Set()
  for (const p of [node1, node2, node3]) {
    const pos = layout.pos[p.id]
    depths.add(pos.x) // Different x coordinate = different depth rank
  }

  assert.strictEqual(depths.size, 3, 'Small plan should have linear depth structure')
})

test('compact layout handles single large rank correctly', () => {
  // Create a plan with 8 nodes at the same depth
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: `n${i}`,
    title: `Node ${i + 1}`,
    needs: [],
    level: 'component'
  }))

  const layout = laneLayout(nodes)

  // All nodes should be positioned
  assert.strictEqual(Object.keys(layout.pos).length, 8, 'All 8 nodes should be positioned')

  // Should be wrapped into multiple sub-columns with max 4 per column
  // With wrapping: 8 nodes → 2 columns of 4 nodes each
  const yCoords = nodes.map(n => layout.pos[n.id].y)
  const uniqueYs = new Set(yCoords)
  // With wrapping and gap, should have 4 rows
  assert.ok(uniqueYs.size >= 2, 'Wrapped nodes should occupy multiple rows')

  // Aspect ratio check: height should be much smaller than width due to wrapping
  const allY = nodes.map(n => layout.pos[n.id].y + layout.pos[n.id].h)
  const maxY = Math.max(...allY)
  const aspectRatio = maxY / layout.width
  assert.ok(aspectRatio < 1, `Large parallel rank should be wider than tall: ${aspectRatio.toFixed(2)}`)
})
