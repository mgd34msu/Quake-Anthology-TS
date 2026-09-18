import { expect, test } from "bun:test";
import { startupSummaryLayout } from "../../src/app/bootstrap/startup-summary.ts";

test("custom summary keeps every label and value above the status footer", () => {
  for (const count of [1, 12, 14]) {
    const bounds = { x: 316, y: 142, width: 260, height: 300 };
    const layout = startupSummaryLayout(count, bounds);
    for (let index = 0; index < count; index++) {
      const y = layout.y + index * layout.rowHeight;
      expect(y + 8 * layout.labelScale).toBeLessThan(y + layout.valueOffset);
      expect(y + layout.valueOffset + 8 * layout.valueScale + 1).toBeLessThanOrEqual(y + layout.rowHeight);
      expect(y + layout.valueOffset + 8 * layout.valueScale + 1).toBeLessThan(bounds.y + bounds.height);
    }
    expect(layout.valueScale).toBeGreaterThan(1.4);
    for (const [width, height] of [[640, 480], [1280, 720], [1920, 1080], [800, 600]]) {
      if (width === undefined || height === undefined) throw new Error("Missing viewport dimension");
      const scale = Math.min(width / 640, height / 480);
      const bottom = (height - 480 * scale) / 2 + (bounds.y + bounds.height) * scale;
      expect(bottom).toBeLessThan(height);
    }
  }
});
