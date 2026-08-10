import test from "node:test";
import assert from "node:assert/strict";
import { calculateClinicalMetrics, parseValidationCsv, wilsonInterval } from "../src/clinicalMetrics.js";

test("calculates confusion counts and inconclusive rate", () => {
  const metrics = calculateClinicalMetrics([
    { actual: "positive", predicted: "positive" },
    { actual: "positive", predicted: "negative" },
    { actual: "negative", predicted: "negative" },
    { actual: "negative", predicted: "positive" },
    { actual: "positive", predicted: "inconclusive" },
  ]);
  assert.deepEqual(metrics.counts, { tp: 1, tn: 1, fp: 1, fn: 1, inconclusive: 1, total: 5 });
  assert.equal(metrics.sensitivity.estimate, 0.5);
  assert.equal(metrics.specificity.estimate, 0.5);
  assert.equal(metrics.inconclusiveRate.estimate, 0.2);
});

test("uses a bounded Wilson interval and parses the required CSV columns", () => {
  const interval = wilsonInterval(10, 10);
  assert.equal(interval.estimate, 1);
  assert.ok(interval.lower >= 0 && interval.upper <= 1);
  assert.deepEqual(parseValidationCsv("actual,predicted\npositive,positive\nnegative,inconclusive\n"), [
    { actual: "positive", predicted: "positive" },
    { actual: "negative", predicted: "inconclusive" },
  ]);
});
