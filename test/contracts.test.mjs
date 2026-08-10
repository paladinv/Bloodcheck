import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HISTORY_TIMEOUT_MINUTES, HISTORY_TIMEOUT_OPTIONS, normalizeHistoryTimeoutMinutes, normalizeSymptomTimeline, normalizeRecoveryPayload } from "../src/history.js";
import { normalizeTelemetryEvent, normalizeTelemetryEvents } from "../src/telemetry.js";
import { validateReleaseEvidence } from "../src/releaseEvidence.js";
import { validateDeviceEvidence } from "../src/deviceEvidence.js";
import { validateDatasetManifest } from "../src/datasetEvidence.js";
import { createTranslator } from "../src/i18n.js";

test("history contracts bound timeout, timeline, and recovery payloads", () => {
  assert.equal(normalizeHistoryTimeoutMinutes("5"), DEFAULT_HISTORY_TIMEOUT_MINUTES);
  assert.ok(HISTORY_TIMEOUT_OPTIONS.includes(0));
  assert.equal(normalizeSymptomTimeline([{ eventDate: "2026-08-09", category: "pain", severity: "mild", context: "brief" }]).length, 1);
  assert.equal(normalizeSymptomTimeline([{ eventDate: "not-a-date", category: "unknown" }]).length, 0);
  assert.equal(normalizeRecoveryPayload({ kind: "bad", schemaVersion: 1, records: [] }), null);
});

test("privacy and governance contracts reject untrusted evidence", () => {
  assert.deepEqual(normalizeTelemetryEvent({ eventType: "scan_quality", source: "camera", qualityStatus: "ok", reasonCodes: ["dark", "secret"] }).reasonCodes, ["dark"]);
  assert.equal(normalizeTelemetryEvents([{ eventType: "scan_quality", source: "camera", qualityStatus: "ok" }, { eventType: "bad" }]).length, 1);
  assert.ok(validateReleaseEvidence({ schemaVersion: 1, release: "x", gates: {} }).length > 0);
  assert.ok(validateDeviceEvidence({ schemaVersion: 1, runs: [] }).length > 0);
  assert.ok(validateDatasetManifest({ schemaVersion: 1, datasetVersion: "x", protocolVersion: "x", clinicianReviewComplete: false, strata: [], acceptanceCriteria: {} }).length > 0);
});

test("localized lazy-settings fallback copy is available", () => {
  assert.match(createTranslator("en")("settingsLoadError"), /settings/i);
  assert.match(createTranslator("es")("retrySettings"), /Reintentar/);
  assert.match(createTranslator("fr")("settingsLoadError"), /confidentialité/i);
});
