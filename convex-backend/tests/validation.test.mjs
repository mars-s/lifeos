import test from "node:test";
import assert from "node:assert/strict";
import { validateDay } from "../convex/validation.mjs";

const day = { date: "2026-10-06", timeZone: "Australia/Melbourne", source: "synthetic" };
test("missing metrics stay missing", () => assert.doesNotThrow(() => validateDay(day)));
test("bad dates rejected", () => assert.throws(() => validateDay({ ...day, date: "2026-02-30" })));
test("bad timezone rejected", () => assert.throws(() => validateDay({ ...day, timeZone: "fake" })));
test("negative steps rejected", () => assert.throws(() => validateDay({ ...day, steps: -1 })));
test("invalid percentage rejected", () => assert.throws(() => validateDay({ ...day, spo2: 101 })));
test("non-finite samples rejected", () => assert.throws(() => validateDay({
  ...day, hrvSeries: [{ t: "2026-10-06T00:00:00Z", v: Infinity }],
})));
