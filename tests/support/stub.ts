function isStub<T extends object>(value: unknown): value is T {
  return typeof value === "object" && value !== null;
}

/**
 * A null-prototype object carrying only the listed members, standing in for a class-typed collaborator the code under test never fully
 * touches. Members the test does not list are absent, so an unexpected read fails loudly as undefined.
 */
export function partialStub<T extends object>(members: object = {}): T {
  const created: unknown = Object.assign(Object.create(null), members);
  if (!isStub<T>(created)) throw new Error("Stub construction failed");
  return created;
}
