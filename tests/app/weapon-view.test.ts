import { expect, test } from "bun:test";
import { anchoredViewWeapon, anchoredViewWeaponAxis, type ViewWeaponEntity } from "../../src/app/bootstrap/weapon-view.ts";
import type { Axis } from "../../src/contracts/math.ts";

const axis: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

function entity(): ViewWeaponEntity & { readonly name: string } {
  return { name: "gun", transform: { origin: { x: 104, y: 198, z: 302 }, axis: [...axis], scale: { x: 1, y: 1, z: 1 } },
    previousOrigin: { x: 100, y: 200, z: 300 }, lightingOrigin: { x: 101, y: 202, z: 303 }, shadowPlane: 40 };
}

test("view weapon follows the rendered eye while preserving its authored offset", () => {
  const gun = entity(), eye = { x: 100, y: 200, z: 300 }, camera = { x: 112, y: 186, z: 306 };
  const anchored = anchoredViewWeapon(gun, eye, camera);
  expect(anchored).not.toBe(gun);
  expect(anchored.name).toBe("gun");
  expect(anchored.transform.origin).toEqual({ x: 116, y: 184, z: 308 });
  expect(anchored.previousOrigin).toEqual({ x: 112, y: 186, z: 306 });
  expect(anchored.lightingOrigin).toEqual({ x: 113, y: 188, z: 309 });
  expect(anchored.shadowPlane).toBe(46);
  expect(anchored.transform.axis).toEqual(gun.transform.axis);
});

test("view weapon axis follows a ninety-degree camera turn while preserving its local tilt", () => {
  // Anchor eye faces +x; final camera faces +y. A gun pitched toward anchor
  // up must keep that pitch relative to the new forward.
  const anchor: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const camera: Axis = [{ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }];
  const gun: Axis = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }];
  expect(anchoredViewWeaponAxis([...gun], [...anchor], [...camera])).toEqual([
    { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }]);
});

test("view weapon already at the rendered eye is returned unchanged", () => {
  const gun = entity(), eye = { x: 100, y: 200, z: 300 };
  expect(anchoredViewWeapon(gun, eye, eye)).toBe(gun);
});
