import { readFile } from "node:fs/promises";
import { validateReleaseEvidence } from "../src/releaseEvidence.js";

const inputIndex = process.argv.indexOf("--input");
const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : "data/release/evidence.example.json";
try {
  const evidence = JSON.parse(await readFile(input, "utf8"));
  const failures = validateReleaseEvidence(evidence);
  if (failures.length) {
    console.error(`Release gate blocked for ${evidence.release || "unknown release"}.`);
    failures.forEach((failure) => console.error(`FAIL: ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`Release gate passed for ${evidence.release}. All required evidence is positively signed off.`);
  }
} catch (error) {
  console.error(`Release gate could not read ${input}: ${error.message}`);
  process.exitCode = 1;
}
