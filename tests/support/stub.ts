// SPDX-License-Identifier: GPL-2.0-or-later
function isStub<T extends object>(value: unknown): value is T {
  return typeof value === "object" && value !== null;
}

/**
 * A null-prototype object carrying only the listed members, standing in for a class-typed collaborator the code under test never fully
 * touches. Members the test does not list are absent, so an unexpected read fails loudly as undefined.
 */
export function partialStub<T extends object>(members: object = {}): T {
  const blank: unknown = Object.create(null);
  if (typeof blank !== "object" || blank === null) throw new Error("Stub construction failed");
  const created: unknown = Object.assign(blank, members);
  if (!isStub<T>(created)) throw new Error("Stub construction failed");
  return created;
}
