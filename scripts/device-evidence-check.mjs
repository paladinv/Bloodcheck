import { readFile } from "node:fs/promises";
import { validateDeviceEvidence } from "../src/deviceEvidence.js";

const inputIndex = process.argv.indexOf("--input");
const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : "data/device/evidence.example.json";
try {
  const failures = validateDeviceEvidence(JSON.parse(await readFile(input, "utf8")));
  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL: ${failure}`));
    process.exitCode = 1;
  } else console.log("Device evidence shape is valid. Outcomes still require human-run device evidence.");
} catch (error) {
  console.error(`Device evidence could not be read: ${error.message}`);
  process.exitCode = 1;
}
