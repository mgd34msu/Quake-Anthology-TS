import { expect, test } from "bun:test";
import type { ImageResourceOperation, RendererImage, RendererResourceOwner, RenderImage } from "../../src/contracts/render.ts";
import { RenderImageJournal } from "../../src/render/image-journal.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";

const identity = createIdentityOwner("image-journal");
const owner: RendererResourceOwner = { identity: Symbol("journal"), session: identity.session, generation: 0 };
const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "probe" }, width: 2, height: 1 };

test("the journal shares creation content with the frontend and copies update buffers", () => {
  const content: RenderImage = { kind: "rgba8", levels: [{ width: 2, height: 1, pixels: new Uint8Array(8) }], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
  const journal = new RenderImageJournal();
  journal.record({ kind: "create-image", image, content, sampling: { wrap: "repeat", filter: "linear" } });
  const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  journal.record({ kind: "update-image", image, level: 0, content: { width: 2, height: 1, pixels } });
  pixels.fill(9);
  const replayed: ImageResourceOperation[] = [];
  journal.replay({ applyImageResource: operation => { replayed.push(operation); return undefined; } });
  expect(replayed.map(operation => operation.kind)).toEqual(["create-image", "update-image"]);
  const [created, updated] = replayed;
  expect(created?.kind === "create-image" && created.content === content).toBe(true);
  expect(updated?.kind === "update-image" ? [...updated.content.pixels] : []).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  journal.record({ kind: "release-image", image });
  const after: ImageResourceOperation[] = [];
  journal.replay({ applyImageResource: operation => { after.push(operation); return undefined; } });
  expect(after).toEqual([]);
});
