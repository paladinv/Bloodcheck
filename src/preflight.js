export const PREVIEW_DIM = 160;

export function calculatePreviewQuality(pixels, width, height, mask) {
  if (!pixels?.length || !width || !height || !mask) {
    return { frameReady: false, bowlVisible: false, lighting: "unknown", detail: "unknown", averageLuminance: 0, detailScore: 0 };
  }
  const luminanceAt = (x, y) => {
    const index = (y * width + x) * 4;
    return 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
  };
  const inside = (x, y) => {
    const dx = (x / width - mask.centerX) / mask.radiusX;
    const dy = (y / height - mask.centerY) / mask.radiusY;
    return dx * dx + dy * dy <= 1;
  };
  let count = 0, total = 0, clipped = 0, edgeTotal = 0, edgeCount = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!inside(x, y)) continue;
      const luminance = luminanceAt(x, y);
      count++;
      total += luminance;
      if (luminance >= 250) clipped++;
      if (x + 2 < width && inside(x + 2, y)) {
        edgeTotal += Math.abs(luminance - luminanceAt(x + 2, y));
        edgeCount++;
      }
    }
  }
  if (!count) return { frameReady: true, bowlVisible: false, lighting: "unknown", detail: "unknown", averageLuminance: 0, detailScore: 0 };
  const averageLuminance = total / count;
  const detailScore = edgeCount ? edgeTotal / edgeCount : 0;
  const lighting = averageLuminance < 38 ? "dim" : averageLuminance > 220 || clipped / count > 0.35 ? "bright" : "ok";
  return {
    frameReady: true,
    bowlVisible: detailScore >= 1.2 || averageLuminance > 38,
    lighting,
    detail: detailScore < 1.2 ? "low" : "ok",
    averageLuminance,
    detailScore,
  };
}

export function getPreflightItems({ cameraReady, preview }) {
  const frameReady = Boolean(cameraReady && preview?.frameReady);
  return [
    { id: "camera", label: "Camera ready", status: cameraReady ? "ready" : "blocked", hardBlocker: !cameraReady },
    { id: "frame", label: "Bowl framing", status: !frameReady ? "blocked" : preview.bowlVisible ? "ready" : "advisory", hardBlocker: !frameReady },
    { id: "lighting", label: "Lighting", status: preview?.lighting === "ok" ? "ready" : preview?.lighting === "unknown" ? "checking" : "advisory", hardBlocker: false },
    { id: "detail", label: "Focus/detail", status: preview?.detail === "ok" ? "ready" : preview?.detail === "unknown" ? "checking" : "advisory", hardBlocker: false },
  ];
}

export function canCaptureFromPreflight(items) {
  return items.every((item) => !item.hardBlocker);
}
