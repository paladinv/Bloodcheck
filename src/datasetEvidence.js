export const DATASET_MANIFEST_VERSION = 1;
export const REQUIRED_STRATA = ["device_family", "browser", "lighting", "toilet_material", "sample_type", "confounder"];

export function validateDatasetManifest(value) {
  const failures = [];
  if (!value || typeof value !== "object" || value.schemaVersion !== DATASET_MANIFEST_VERSION || typeof value.datasetVersion !== "string" || typeof value.protocolVersion !== "string") return ["Dataset manifest needs schemaVersion, datasetVersion, and protocolVersion."];
  if (value.clinicianReviewComplete === true) failures.push("This repository must not claim clinician review is complete without controlled evidence.");
  if (!Array.isArray(value.strata) || REQUIRED_STRATA.some((stratum) => !value.strata.includes(stratum))) failures.push("Dataset manifest must list every required evidence stratum.");
  if (!value.acceptanceCriteria || typeof value.acceptanceCriteria !== "object") failures.push("Acceptance criteria are required.");
  return failures;
}

export function validateStratifiedEvidence(value) {
  if (!Array.isArray(value)) return ["Stratified evidence must be an array."];
  return value.flatMap((row, index) => {
    if (!row || typeof row !== "object" || typeof row.stratum !== "string" || !row.metrics || typeof row.metrics !== "object") return [`Stratum ${index + 1} is invalid.`];
    return [];
  });
}
