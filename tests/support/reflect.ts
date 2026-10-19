// Policy-clean access to simulation internals in tests: every reflected
// value is bound to unknown and validated before use, never asserted.

export function readField(target: object, name: string): unknown {
  const value: unknown = Reflect.get(target, name);
  return value;
}

export function readObject(target: object, name: string): object {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "object" || value === null) throw new Error(`Expected object field ${name}`);
  return value;
}

export function readObjectOrNull(target: object, name: string): object | null {
  const value: unknown = Reflect.get(target, name);
  if (value === null) return null;
  if (typeof value !== "object") throw new Error(`Expected object-or-null field ${name}`);
  return value;
}

export function readNumber(target: object, name: string): number {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "number") throw new Error(`Expected numeric field ${name}`);
  return value;
}

export function readBoolean(target: object, name: string): boolean {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "boolean") throw new Error(`Expected boolean field ${name}`);
  return value;
}

export function readString(target: object, name: string): string {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "string") throw new Error(`Expected string field ${name}`);
  return value;
}

export function numberValue(value: unknown, what: string): number {
  if (typeof value !== "number") throw new Error(`Expected numeric ${what}`);
  return value;
}

export function objectValue(value: unknown, what: string): object {
  if (typeof value !== "object" || value === null) throw new Error(`Expected object ${what}`);
  return value;
}

export function callMethod(target: object, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== "function") throw new Error(`Expected method ${name}`);
  const result: unknown = Reflect.apply(method, target, args);
  return result;
}

export function callFunction(fn: unknown, thisArg: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("Expected function value");
  const result: unknown = Reflect.apply(fn, thisArg, args);
  return result;
}
