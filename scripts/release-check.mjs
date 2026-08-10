import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

const required = ["index.html", "public/manifest.json", "public/sw.js", "docs/RELEASE_CHECKLIST.md", "docs/CLINICAL_VALIDATION.md"];
const failures = [];
for (const path of required) {
  try { await access(path); } catch { failures.push(`Missing required release file: ${path}`); }
}
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!packageJson.scripts?.build || !packageJson.scripts?.test) failures.push("package.json must define build and test scripts.");
const index = await readFile("index.html", "utf8");
if (!index.includes("manifest.json") || !index.includes("serviceWorker")) failures.push("index.html must link the manifest and register the service worker.");
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
if (!manifest.name || !manifest.icons?.length || manifest.display !== "standalone") failures.push("PWA manifest is incomplete.");
const sw = await readFile("public/sw.js", "utf8");
if (!/CACHE_NAME\s*=\s*["']healthscan-v\d+["']/.test(sw)) failures.push("Service-worker cache version is missing or not versioned.");
if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Static release checks passed. Real-device Safari/Chrome permissions, PWA lifecycle, VoiceOver/TalkBack, and clinical gates remain manual release checks.");
}
