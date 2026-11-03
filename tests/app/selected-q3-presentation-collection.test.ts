import { expect, test } from "bun:test";
import { ApplicationSelectedQ3Presentations, type SelectedQ3Presentation, type SelectedQ3PresentationOptions } from "../../src/app/bootstrap/selected-q3-presentation.ts";
import { partialStub } from "../support/stub.ts";
import type { WorldSeatPresentation } from "../../src/app/bootstrap/presentation.ts";

// The collection only reads the options when it creates a seat consumer, which these rows never reach.
const options = partialStub<SelectedQ3PresentationOptions>();
const seats = (count: number): readonly WorldSeatPresentation[] => Array.from({ length: count }, () => partialStub<WorldSeatPresentation>());
const sourceWithoutClients = partialStub<SelectedQ3Presentation>({ content: "content:q3", state: { clients: [] } });

test("selected Q3 presentations: no source means nothing is created and no seat is kept", async () => {
  const collection = new ApplicationSelectedQ3Presentations(options);
  await collection.prepare(seats(2), null, [], 1);
  await collection.prepare([], null, [], 2);
  collection.close();
});

test("selected Q3 presentations: a seat whose actor is not a client of the source gets no consumer", async () => {
  const collection = new ApplicationSelectedQ3Presentations(options);
  await collection.prepare(seats(2), sourceWithoutClients, [], 1);
  collection.retainPresentations([]);
  collection.close();
});

test("selected Q3 presentations: a closed collection rejects further work and closes idempotently", async () => {
  const collection = new ApplicationSelectedQ3Presentations(options);
  collection.close();
  collection.close();
  expect(() => collection.retainPresentations([])).toThrow("closed");
  await expect(collection.prepare([], null, [], 1)).rejects.toThrow("closed or already preparing");
});

test("selected Q3 presentations: a failed preparation leaves the collection usable", async () => {
  const collection = new ApplicationSelectedQ3Presentations(options);
  const broken = partialStub<SelectedQ3Presentation>({ content: "content:q3", state: {} });
  await expect(collection.prepare(seats(1), broken, [], 1)).rejects.toThrow();
  await collection.prepare([], null, [], 2);
  collection.close();
});
