export const TELEMETRY_PREFERENCE_KEY = "healthscan-quality-telemetry-opt-in-v1";
export const TELEMETRY_EVENTS_KEY = "healthscan-quality-telemetry-events-v1";
export const MAX_TELEMETRY_EVENTS = 100;
const EVENT_TYPES = new Set(["scan_quality", "camera_error", "analysis_error"]);
const SOURCES = new Set(["camera", "photo"]);
const QUALITY = new Set(["unknown", "ok", "inconclusive"]);
const REASONS = new Set(["dark", "bright", "low-detail", "frame", "camera", "analysis"]);

export function normalizeTelemetryEvent(value) {
  if (!value || typeof value !== "object") return null;
  if (!EVENT_TYPES.has(value.eventType) || !SOURCES.has(value.source) || !QUALITY.has(value.qualityStatus)) return null;
  const reasonCodes = Array.isArray(value.reasonCodes)
    ? [...new Set(value.reasonCodes.filter((reason) => REASONS.has(reason)))].slice(0, 4)
    : [];
  return { schemaVersion: 1, eventType: value.eventType, source: value.source, qualityStatus: value.qualityStatus, reasonCodes };
}

export function normalizeTelemetryEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeTelemetryEvent).filter(Boolean).slice(-MAX_TELEMETRY_EVENTS);
}

export function isTelemetryOptedIn(storage) {
  try { return storage?.getItem(TELEMETRY_PREFERENCE_KEY) === "true"; } catch { return false; }
}

export function setTelemetryOptIn(storage, enabled) {
  try { storage?.setItem(TELEMETRY_PREFERENCE_KEY, enabled ? "true" : "false"); } catch {}
  if (!enabled) {
    try { storage?.removeItem(TELEMETRY_EVENTS_KEY); } catch {}
  }
  return Boolean(enabled);
}

export function recordTelemetryEvent(storage, event) {
  const normalized = normalizeTelemetryEvent(event);
  if (!normalized || !isTelemetryOptedIn(storage)) return [];
  let existing = [];
  try { existing = normalizeTelemetryEvents(JSON.parse(storage?.getItem(TELEMETRY_EVENTS_KEY) || "[]")); } catch {}
  const next = [...existing, normalized].slice(-MAX_TELEMETRY_EVENTS);
  try { storage?.setItem(TELEMETRY_EVENTS_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function loadTelemetryEvents(storage) {
  try { return normalizeTelemetryEvents(JSON.parse(storage?.getItem(TELEMETRY_EVENTS_KEY) || "[]")); } catch { return []; }
}

export function createTelemetryExport(storage) {
  return JSON.stringify({ kind: "healthscan-quality-telemetry", schemaVersion: 1, events: loadTelemetryEvents(storage) }, null, 2);
}
