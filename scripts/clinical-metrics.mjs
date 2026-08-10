import { readFile, writeFile } from "node:fs/promises";
import { parseValidationCsv, calculateClinicalMetrics } from "../src/clinicalMetrics.js";

const inputIndex = process.argv.indexOf("--input");
const outputIndex = process.argv.indexOf("--output");
if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
  console.error("Usage: npm run clinical:metrics -- --input path/to/deidentified.csv [--output metrics.json]");
  process.exitCode = 2;
} else {
  try {
    const rows = parseValidationCsv(await readFile(process.argv[inputIndex + 1], "utf8"));
    const metrics = calculateClinicalMetrics(rows);
    const output = JSON.stringify(metrics, null, 2) + "\n";
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) await writeFile(process.argv[outputIndex + 1], output, "utf8");
    else process.stdout.write(output);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
