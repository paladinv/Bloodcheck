export const LANGUAGE_PREFERENCE_KEY = "healthscan-language-v1";
export const ACCESSIBILITY_PREFERENCE_KEY = "healthscan-accessibility-v1";

export const DEFAULT_ACCESSIBILITY_PREFERENCES = {
  textSize: "normal",
  contrast: "standard",
};

const TEXT_SIZES = new Set(["normal", "large", "extra-large"]);
const CONTRASTS = new Set(["standard", "high"]);

export function normalizeAccessibilityPreferences(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    textSize: TEXT_SIZES.has(candidate.textSize) ? candidate.textSize : DEFAULT_ACCESSIBILITY_PREFERENCES.textSize,
    contrast: CONTRASTS.has(candidate.contrast) ? candidate.contrast : DEFAULT_ACCESSIBILITY_PREFERENCES.contrast,
  };
}

export function loadAccessibilityPreferences(storage) {
  try {
    const raw = storage?.getItem(ACCESSIBILITY_PREFERENCE_KEY);
    return normalizeAccessibilityPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_ACCESSIBILITY_PREFERENCES };
  }
}

export function saveAccessibilityPreferences(storage, value) {
  const normalized = normalizeAccessibilityPreferences(value);
  try {
    storage?.setItem(ACCESSIBILITY_PREFERENCE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences are optional; the app remains usable when storage is blocked.
  }
  return normalized;
}

export function loadLanguagePreference(storage) {
  try {
    const language = storage?.getItem(LANGUAGE_PREFERENCE_KEY);
    return ["en", "es", "fr"].includes(language) ? language : "en";
  } catch {
    return "en";
  }
}

export function saveLanguagePreference(storage, language) {
  const normalized = ["en", "es", "fr"].includes(language) ? language : "en";
  try { storage?.setItem(LANGUAGE_PREFERENCE_KEY, normalized); } catch {}
  return normalized;
}
