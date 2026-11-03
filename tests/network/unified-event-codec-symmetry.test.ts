// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/app/bootstrap/network/unified-event-codec.ts", import.meta.url), "utf8");

/** Each reader and writer is a single function whose text runs to the next top-level declaration. */
function functionTexts(): Map<string, string> {
  const texts = new Map<string, string>();
  const starts = [...source.matchAll(/^(?:export )?(?:function|type|const) (\w+)/gm)];
  for (const [index, match] of starts.entries()) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    const end = starts[index + 1]?.index ?? source.length;
    texts.set(name, source.slice(match.index, end));
  }
  return texts;
}
const readFields = (text: string): string[] => [...new Set([...text.matchAll(/reader\.field\(["'](\w+)["']\)/g)].map(match => match[1] ?? ""))].sort();
const caseLabels = (text: string): string[] => [...new Set([...text.matchAll(/case ["']([\w:-]+)["']:/g)].map(match => match[1] ?? ""))].sort();
const writeFields = (text: string): string[] =>
  [
    ...new Set(
      [...text.matchAll(/value(?:\[["'](\w+)["']\]|\.(\w+))/g)]
        .filter(match => match[1] !== undefined || (match[2] !== "map" && match[2] !== "length"))
        .map(match => match[1] ?? match[2] ?? ""),
    ),
  ].sort();

test("every generated event reader reads exactly the fields and variants its writer writes", () => {
  const texts = functionTexts();
  let pairs = 0;
  for (const [name, reader] of texts) {
    if (!name.startsWith("readEvent")) continue;
    const writer = texts.get(`write${name.slice(4)}`);
    if (writer === undefined) continue;
    pairs++;
    const written = writeFields(writer),
      read = readFields(reader);
    // The hand-edited writers copy a record with `...value`, so only their explicit fields can be compared.
    const spread = writer.includes("...value");
    const comparable = read.filter(field => !spread || written.includes(field));
    expect({ name, fields: comparable.filter(field => field !== "kind" || written.includes("kind")) }).toEqual({
      name,
      fields: written.filter(field => field !== "kind" || read.includes("kind")),
    });
    const kinds = caseLabels(writer);
    if (kinds.length > 0) expect({ name, kinds: caseLabels(reader) }).toEqual({ name, kinds });
  }
  expect(pairs).toBeGreaterThan(80);
});
