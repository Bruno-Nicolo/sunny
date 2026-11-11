/** Page IDs are zero-based positions in the document opened by the dialog. */
export function initialPageOrder(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

export function validatePageOrder(order: number[], count: number): void {
  if (
    !order.length ||
    new Set(order).size !== order.length ||
    order.some((page) => !Number.isInteger(page) || page < 0 || page >= count)
  )
    throw new Error('Invalid page selection.')
}

/** Move selected pages, preserving their visible order, before an unselected page. */
export function movePages(
  order: number[],
  selected: ReadonlySet<number>,
  before: number | null
): number[] {
  const moving: number[] = []
  const remaining: number[] = []
  for (const page of order) (selected.has(page) ? moving : remaining).push(page)
  if (before !== null && selected.has(before)) return order
  const index = before === null ? remaining.length : remaining.indexOf(before)
  if (index < 0 || !moving.length) return order
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)]
}

/** Follow a surviving page, or the next surviving original page after a deletion. */
export function retainedPage(order: number[], current: number): number {
  let next = -1
  let last = 0
  for (const [index, page] of order.entries()) {
    if (page === current - 1) return index + 1
    if (page > current - 1 && (next === -1 || page < order[next])) next = index
    if (page > order[last]) last = index
  }
  return (next === -1 ? last : next) + 1
}

/** Choose the insertion boundary in the compact grid using the nearest card's left/right half. */
export function findPageDropBefore(
  cells: { page: number; left: number; right: number; top: number; bottom: number }[],
  pointer: { x: number; y: number }
): number | null {
  if (!cells.length) return null
  let top = Infinity
  let bottom = -Infinity
  let nearest = 0
  let distance = Infinity
  for (const [index, cell] of cells.entries()) {
    top = Math.min(top, cell.top)
    bottom = Math.max(bottom, cell.bottom)
    const dx = Math.max(cell.left - pointer.x, 0, pointer.x - cell.right)
    const dy = Math.max(cell.top - pointer.y, 0, pointer.y - cell.bottom)
    const next = dx * dx + dy * dy
    if (next < distance) {
      nearest = index
      distance = next
    }
  }
  if (pointer.y > bottom) return null
  if (pointer.y < top) return cells[0].page
  const cell = cells[nearest]
  return pointer.x <= (cell.left + cell.right) / 2 ? cell.page : (cells[nearest + 1]?.page ?? null)
}
