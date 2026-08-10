export const REQUIRED_DEVICE_SCENARIOS = ["allow", "deny", "revoke", "background-resume", "pwa-offline", "photo-fallback"];

export function validateDeviceEvidence(value) {
  const failures = [];
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !Array.isArray(value.runs)) return ["Device evidence must include schemaVersion 1 and runs."];
  const seen = new Set();
  for (const run of value.runs) {
    if (!run || typeof run !== "object" || !["ios-safari", "android-chrome"].includes(run.platform) || typeof run.device !== "string" || !run.scenario || !["pass", "fail", "blocked", "not-run"].includes(run.outcome)) failures.push("Each device run needs platform, device, scenario, and a valid outcome.");
    else seen.add(`${run.platform}:${run.scenario}`);
  }
  for (const platform of ["ios-safari", "android-chrome"]) for (const scenario of REQUIRED_DEVICE_SCENARIOS) if (!seen.has(`${platform}:${scenario}`)) failures.push(`${platform}: missing ${scenario}`);
  return failures;
}
