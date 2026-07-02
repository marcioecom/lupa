import { describe, expect, it } from "vitest";
import { chunkArray, dedupeByKey } from "../src/scraper/concurrency";

describe("dedupeByKey", () => {
  it("removes duplicate keys, keeping the last occurrence", () => {
    const items = [
      { externalId: "a", v: 1 },
      { externalId: "b", v: 2 },
      { externalId: "a", v: 3 },
    ];
    const out = dedupeByKey(items, (i) => i.externalId);
    expect(out).toEqual([
      { externalId: "a", v: 3 },
      { externalId: "b", v: 2 },
    ]);
  });

  it("preserves order of first appearance", () => {
    const items = [
      { externalId: "z" },
      { externalId: "y" },
      { externalId: "z" },
      { externalId: "x" },
    ];
    expect(dedupeByKey(items, (i) => i.externalId).map((i) => i.externalId)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });

  it("guarantees no chunk repeats a conflict key (the ON CONFLICT invariant)", () => {
    // Reproduces the upstream cause of the Postgres error
    // "ON CONFLICT DO UPDATE command cannot affect row a second time":
    // a scraped batch with a repeated externalId must become unique before upsert.
    const scraped = [
      { externalId: "dup" },
      { externalId: "dup" },
      { externalId: "other" },
    ];
    const deduped = dedupeByKey(scraped, (i) => i.externalId);
    for (const chunk of chunkArray(deduped, 500)) {
      const keys = chunk.map((i) => i.externalId);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeByKey([], (i: { externalId: string }) => i.externalId)).toEqual([]);
  });
});
