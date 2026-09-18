/** Text layout uses eight logical units per scale; keep both lines and their shadow inside each row. */
export function startupSummaryLayout(count: number, bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) {
  const rowHeight = Math.min(30, bounds.height / Math.max(1, count));
  const density = Math.min(1, (rowHeight - 2) / (8 * (1.35 + 2.1) + 1));
  const labelScale = 1.35 * density, valueScale = 2.1 * density;
  return { x: bounds.x, y: bounds.y, width: bounds.width, rowHeight, labelScale, valueScale,
    valueOffset: 8 * labelScale + density };
}
