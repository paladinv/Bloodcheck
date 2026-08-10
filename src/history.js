export const HISTORY_DB_NAME = "healthscan-encrypted-history-v1";
export const HISTORY_DB_VERSION = 1;
export const HISTORY_STORE = "records";
export const HISTORY_META_STORE = "meta";
export const LEGACY_HISTORY_KEY = "healthscan-summary-history-v1";
export const LEGACY_HISTORY_ENABLED_KEY = `${LEGACY_HISTORY_KEY}:enabled`;
export const HISTORY_ITERATIONS = 310000;
export const RECOVERY_ITERATIONS = 210000;
export const HISTORY_TIMEOUT_OPTIONS = [0, 1, 5, 15, 30];
export const DEFAULT_HISTORY_TIMEOUT_MINUTES = 5;
export const SYMPTOM_CATEGORIES = ["pain", "bleeding", "bowel-change", "urinary-change", "fever", "dizziness", "other"];
export const SYMPTOM_SEVERITIES = ["unknown", "mild", "moderate", "severe"];
export const MAX_TIMELINE_EVENTS = 30;
export const MAX_HISTORY_RECORDS = 50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createHistoryRecordId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `hs_${cryptoApi.randomUUID()}`;
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return `hs_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return `hs_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getCrypto(cryptoLike = globalThis.crypto) {
  if (!cryptoLike?.subtle || !cryptoLike?.getRandomValues) throw new Error("WebCrypto is unavailable.");
  return cryptoLike;
}

export function isEncryptedHistoryAvailable(env = globalThis) {
  return Boolean(env?.indexedDB && env?.crypto?.subtle && env?.crypto?.getRandomValues);
}

export function isValidPasscode(passcode) {
  return typeof passcode === "string" && passcode.length >= 8 && passcode.length <= 128;
}

export function normalizeHistoryTimeoutMinutes(value) {
  const number = Number(value);
  return HISTORY_TIMEOUT_OPTIONS.includes(number) ? number : DEFAULT_HISTORY_TIMEOUT_MINUTES;
}

export function normalizeSymptomTimeline(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TIMELINE_EVENTS).map((event) => {
    if (!event || typeof event !== "object") return null;
    const eventDate = typeof event.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.eventDate) ? event.eventDate : null;
    if (!eventDate || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`))) return null;
    if (!SYMPTOM_CATEGORIES.includes(event.category)) return null;
    return {
      id: typeof event.id === "string" && /^evt_[a-zA-Z0-9_-]{6,100}$/.test(event.id) ? event.id : createHistoryRecordId().replace(/^hs_/, "evt_"),
      eventDate,
      category: event.category,
      severity: SYMPTOM_SEVERITIES.includes(event.severity) ? event.severity : "unknown",
      context: typeof event.context === "string" ? event.context.slice(0, 300) : "",
    };
  }).filter(Boolean);
}

export function normalizeHistoryRecord(value) {
  if (!value || typeof value !== "object") return null;
  const allowedStatuses = new Set(["unavailable", "inconclusive", "markers", "clear"]);
  const allowedTypes = new Set(["unknown", "urine", "stool", "both"]);
  const detectionLabels = Array.isArray(value.detectionLabels)
    ? value.detectionLabels.filter((label) => typeof label === "string" && label.length <= 80).slice(0, 20)
    : [];
  if (typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp))) return null;
  if (!allowedStatuses.has(value.status) || !allowedTypes.has(value.sampleType)) return null;
  const annotations = value.annotations && typeof value.annotations === "object" ? {
    symptoms: typeof value.annotations.symptoms === "string" ? value.annotations.symptoms.slice(0, 1000) : "",
    medications: typeof value.annotations.medications === "string" ? value.annotations.medications.slice(0, 1000) : "",
    timeline: normalizeSymptomTimeline(value.annotations.timeline),
  } : { symptoms: "", medications: "" };
  return {
    id: typeof value.id === "string" && /^hs_[a-zA-Z0-9_-]{8,100}$/.test(value.id) ? value.id : createHistoryRecordId(),
    timestamp: value.timestamp,
    status: value.status,
    severity: value.severity === "urgent" || value.severity === "warning" || value.severity === "caution" ? value.severity : null,
    detectionLabels,
    sampleType: value.sampleType,
    annotations: { ...annotations, timeline: annotations.timeline || [] },
  };
}

export function createRecoveryPayload(records) {
  const normalized = Array.isArray(records) ? records.map(normalizeHistoryRecord).filter(Boolean).slice(0, MAX_HISTORY_RECORDS) : [];
  return { kind: "healthscan-history-backup", schemaVersion: 1, records: normalized };
}

export function normalizeRecoveryPayload(value) {
  if (!value || typeof value !== "object" || value.kind !== "healthscan-history-backup" || value.schemaVersion !== 1 || !Array.isArray(value.records)) return null;
  if (value.records.length > MAX_HISTORY_RECORDS) return null;
  const records = value.records.map(normalizeHistoryRecord);
  if (records.some((record) => !record)) return null;
  return { kind: value.kind, schemaVersion: value.schemaVersion, records };
}

export function isValidRecoveryPassphrase(passphrase) {
  return typeof passphrase === "string" && passphrase.length >= 12 && passphrase.length <= 128;
}

function openDatabase(indexedDBLike = globalThis.indexedDB) {
  if (!indexedDBLike) return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDBLike.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HISTORY_META_STORE)) db.createObjectStore(HISTORY_META_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open encrypted history."));
  });
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

async function getMeta(db) {
  return requestAsPromise(db.transaction(HISTORY_META_STORE, "readonly").objectStore(HISTORY_META_STORE).get("config"));
}

async function putMeta(db, value) {
  return requestAsPromise(db.transaction(HISTORY_META_STORE, "readwrite").objectStore(HISTORY_META_STORE).put(value));
}

async function deriveKey(passcode, salt, cryptoLike = globalThis.crypto, iterations = HISTORY_ITERATIONS) {
  const cryptoApi = getCrypto(cryptoLike);
  const material = await cryptoApi.subtle.importKey("raw", encoder.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptJson(key, value, cryptoLike = globalThis.crypto) {
  const cryptoApi = getCrypto(cryptoLike);
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptJson(key, record, cryptoLike = globalThis.crypto) {
  const cryptoApi = getCrypto(cryptoLike);
  if (!Array.isArray(record?.iv) || !Array.isArray(record?.ciphertext)) throw new Error("Invalid encrypted record.");
  const plaintext = await cryptoApi.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, key, new Uint8Array(record.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

export async function getHistoryStatus(env = globalThis) {
  if (!isEncryptedHistoryAvailable(env)) return { available: false, configured: false };
  const db = await openDatabase(env.indexedDB);
  const config = await getMeta(db);
  db.close();
  return { available: true, configured: Boolean(config?.salt && config?.verifier) };
}

export async function setupOrUnlockHistory(passcode, { create = false, env = globalThis } = {}) {
  if (!isValidPasscode(passcode)) throw new Error("Use a passcode between 8 and 128 characters.");
  const cryptoApi = getCrypto(env.crypto);
  const db = await openDatabase(env.indexedDB);
  let config = await getMeta(db);
  if (!config) {
    if (!create) { db.close(); throw new Error("Encrypted history is not set up yet."); }
    const salt = Array.from(cryptoApi.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(passcode, salt, env.crypto);
    const verifier = await encryptJson(key, { kind: "healthscan-history-verifier", version: 1 }, env.crypto);
    config = { id: "config", version: 1, iterations: HISTORY_ITERATIONS, salt, verifier };
    await putMeta(db, config);
    db.close();
    return key;
  }
  try {
    const key = await deriveKey(passcode, config.salt, env.crypto);
    const verifier = await decryptJson(key, config.verifier, env.crypto);
    if (verifier?.kind !== "healthscan-history-verifier") throw new Error("Incorrect passcode.");
    db.close();
    return key;
  } catch {
    db.close();
    throw new Error("Incorrect passcode or unreadable encrypted history.");
  }
}

export async function listHistoryRecords(key, env = globalThis) {
  const db = await openDatabase(env.indexedDB);
  const rows = await requestAsPromise(db.transaction(HISTORY_STORE, "readonly").objectStore(HISTORY_STORE).getAll());
  const records = [];
  for (const row of rows || []) {
    try {
      const normalized = normalizeHistoryRecord(await decryptJson(key, row, env.crypto));
      if (normalized) records.push(normalized);
    } catch {
      // Ignore malformed/tampered rows instead of rendering untrusted storage.
    }
  }
  db.close();
  return records.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, MAX_HISTORY_RECORDS);
}

export async function saveHistoryRecord(key, value, env = globalThis) {
  const record = normalizeHistoryRecord(value);
  if (!record) throw new Error("Invalid history record.");
  const encrypted = await encryptJson(key, record, env.crypto);
  const db = await openDatabase(env.indexedDB);
  await requestAsPromise(db.transaction(HISTORY_STORE, "readwrite").objectStore(HISTORY_STORE).put({ id: record.id, ...encrypted }));
  db.close();
  return record;
}

export async function exportHistoryBackup(key, recoveryPassphrase, env = globalThis) {
  if (!isValidRecoveryPassphrase(recoveryPassphrase)) throw new Error("Use a separate recovery passphrase between 12 and 128 characters.");
  const payload = createRecoveryPayload(await listHistoryRecords(key, env));
  const cryptoApi = getCrypto(env.crypto);
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const recoveryKey = await deriveKey(recoveryPassphrase, salt, env.crypto, RECOVERY_ITERATIONS);
  const encrypted = await encryptJson(recoveryKey, payload, env.crypto);
  return JSON.stringify({ kind: "healthscan-history-recovery", schemaVersion: 1, kdf: "PBKDF2-SHA-256", iterations: RECOVERY_ITERATIONS, salt: Array.from(salt), ...encrypted });
}

export async function importHistoryBackup(key, serialized, recoveryPassphrase, env = globalThis) {
  if (!isValidRecoveryPassphrase(recoveryPassphrase)) throw new Error("Use the recovery passphrase used for this backup.");
  let envelope;
  try { envelope = typeof serialized === "string" ? JSON.parse(serialized) : serialized; } catch { throw new Error("Recovery file is not valid JSON."); }
  if (!envelope || envelope.kind !== "healthscan-history-recovery" || envelope.schemaVersion !== 1 || envelope.iterations !== RECOVERY_ITERATIONS || !Array.isArray(envelope.salt)) throw new Error("Recovery file format is invalid.");
  const recoveryKey = await deriveKey(recoveryPassphrase, new Uint8Array(envelope.salt), env.crypto, RECOVERY_ITERATIONS);
  let payload;
  try { payload = normalizeRecoveryPayload(await decryptJson(recoveryKey, envelope, env.crypto)); } catch { throw new Error("Recovery passphrase is incorrect or the file is unreadable."); }
  if (!payload) throw new Error("Recovery payload failed validation.");
  for (const record of payload.records) await saveHistoryRecord(key, record, env);
  return payload.records.length;
}

export async function migrateLegacyHistory(key, env = globalThis) {
  let raw;
  try { raw = env.localStorage?.getItem(LEGACY_HISTORY_KEY); } catch { return 0; }
  if (!raw) return 0;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Legacy history could not be read safely."); }
  if (!Array.isArray(parsed)) throw new Error("Legacy history has an invalid shape.");
  let count = 0;
  for (const candidate of parsed) {
    const record = normalizeHistoryRecord(candidate);
    if (record) { await saveHistoryRecord(key, record, env); count++; }
  }
  try {
    env.localStorage.removeItem(LEGACY_HISTORY_KEY);
    env.localStorage.removeItem(LEGACY_HISTORY_ENABLED_KEY);
  } catch {
    // Encrypted writes already succeeded; leave a recoverable legacy copy if deletion is blocked.
  }
  return count;
}

export async function resetHistory(env = globalThis) {
  if (env.indexedDB) await new Promise((resolve, reject) => {
    const request = env.indexedDB.deleteDatabase(HISTORY_DB_NAME);
    request.onsuccess = request.onblocked = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not delete encrypted history."));
  });
  try {
    env.localStorage?.removeItem(LEGACY_HISTORY_KEY);
    env.localStorage?.removeItem(LEGACY_HISTORY_ENABLED_KEY);
  } catch {}
}
