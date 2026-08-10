export function wilsonInterval(successes, trials, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials < 0 || successes < 0 || successes > trials) throw new Error("Invalid binomial counts.");
  if (trials === 0) return { estimate: null, lower: null, upper: null };
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const spread = (z / denominator) * Math.sqrt((p * (1 - p) / trials) + (z * z / (4 * trials * trials)));
  return { estimate: p, lower: Math.max(0, center - spread), upper: Math.min(1, center + spread) };
}

export function calculateClinicalMetrics(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("At least one validation row is required.");
  const counts = { tp: 0, tn: 0, fp: 0, fn: 0, inconclusive: 0, total: rows.length };
  rows.forEach((row, index) => {
    const actual = row.actual ?? row.reference;
    const predicted = row.predicted ?? row.prediction;
    if (!["positive", "negative"].includes(actual) || !["positive", "negative", "inconclusive"].includes(predicted)) throw new Error(`Invalid label at row ${index + 1}.`);
    if (predicted === "inconclusive") { counts.inconclusive++; return; }
    if (actual === "positive" && predicted === "positive") counts.tp++;
    if (actual === "negative" && predicted === "negative") counts.tn++;
    if (actual === "negative" && predicted === "positive") counts.fp++;
    if (actual === "positive" && predicted === "negative") counts.fn++;
  });
  const metric = (successes, trials) => wilsonInterval(successes, trials);
  return {
    counts,
    sensitivity: metric(counts.tp, counts.tp + counts.fn),
    specificity: metric(counts.tn, counts.tn + counts.fp),
    ppv: metric(counts.tp, counts.tp + counts.fp),
    npv: metric(counts.tn, counts.tn + counts.fn),
    inconclusiveRate: metric(counts.inconclusive, counts.total),
    determinateRate: metric(counts.total - counts.inconclusive, counts.total),
    methodology: "Wilson 95% confidence intervals; primary classification metrics exclude inconclusive predictions and report them separately.",
  };
}

export function parseValidationCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must include a header and at least one row.");
  const headers = lines[0].split(",").map((value) => value.trim());
  const actualIndex = headers.indexOf("actual");
  const predictedIndex = headers.indexOf("predicted");
  if (actualIndex < 0 || predictedIndex < 0) throw new Error("CSV must include actual,predicted columns.");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return { actual: values[actualIndex]?.trim(), predicted: values[predictedIndex]?.trim() };
  });
}
