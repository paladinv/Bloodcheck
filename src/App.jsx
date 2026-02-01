
import { useState, useRef, useCallback, useEffect } from "react";

// ─── COLOR SCIENCE: Blood Detection Ranges ───────────────────────────────────
// Blood in urine/stool appears across a spectrum:
//   Bright red    → fresh blood (urinary tract)
//   Dark red      → older blood or GI bleed
//   Brown/maroon  → digested blood (upper GI)
//   Black (tarry) → heavily digested blood (upper GI - melena)
// Detection runs on CORRECTED pixels (white-balanced + shade-normalised).

const BLOOD_PROFILES = [
  { label: "Bright Red", hMin: 0, hMax: 15, sMin: 45, sMax: 100, lMin: 25, lMax: 55, color: "#ef4444", severity: "urgent" },
  { label: "Dark Red", hMin: 340, hMax: 360, sMin: 40, sMax: 100, lMin: 15, lMax: 40, color: "#991b1b", severity: "urgent" },
  { label: "Maroon", hMin: 0, hMax: 20, sMin: 30, sMax: 80, lMin: 10, lMax: 25, color: "#7f1d1d", severity: "warning" },
  { label: "Brown Blood", hMin: 15, hMax: 40, sMin: 25, sMax: 70, lMin: 8, lMax: 22, color: "#b45309", severity: "warning" },
  { label: "Black (Tarry)", hMin: 0, hMax: 360, sMin: 0, sMax: 30, lMin: 2, lMax: 10, color: "#1f2937", severity: "caution" },
];

// ─── COLOUR-CORRECTION PIPELINE ───────────────────────────────────────────────
// Two problems that corrupt blood detection in real bathroom photos:
//   1. WHITE-BALANCE SHIFT — tungsten bulbs push everything orange/yellow,
//      cool LEDs push blue/green.  An orange cast is indistinguishable from
//      "Brown Blood" without correction.
//   2. SHADOW / SHADE — the user's body or the toilet lid casts a dark patch
//      over part of the bowl.  Blood hidden in that shadow drops below
//      detection thresholds, or shifts hue toward black.
//
// Strategy:
//   Stage 1 – Global white-balance: find the brightest near-white pixels
//     (the porcelain rim), compute per-channel gain to neutralise them to
//     a known target white.
//   Stage 2 – Local shade correction: divide the image into a coarse grid,
//     measure each cell's average luminance, then scale each pixel so that
//     shadowed regions are brightened back toward the image-wide average.
//
// Both stages produce a corrected R,G,B that is fed to matchesBlood().
// The original pixel data is never mutated; correction is applied on the fly.

// Target neutral white that porcelain should map to after correction.
const TARGET_WHITE = 240;

// Helper: fast median of a typed array (works on Float64Array or plain array)
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Stage 1: compute per-channel white-balance gains ──────────────────────────
// We collect pixels that are "probably porcelain":
//   • luminance in the top 15 % of the image
//   • all three channels ≥ 140 (excludes dark water, coloured objects)
// Then take the MEDIAN of each channel (robust against water/blood outliers).
// Gain = TARGET_WHITE / median.  Clamped to [0.6, 1.6] for safety.
function computeWhiteBalanceGains(data, width, height) {
  // First pass: collect all luminances to find the top-15 % threshold
  const step = 4; // sample every 4th pixel for speed
  const luminances = [];
  for (let i = 0; i < data.length; i += step * 4) {
    luminances.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  luminances.sort((a, b) => a - b);
  const thresholdIdx = Math.floor(luminances.length * 0.85); // top 15 %
  const lumThreshold = luminances[thresholdIdx];

  // Second pass: collect R, G, B of pixels above that luminance AND all ch ≥ 140
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= lumThreshold && r >= 140 && g >= 140 && b >= 140) {
      rs.push(r); gs.push(g); bs.push(b);
    }
  }

  // If we couldn't find enough white pixels (very dark / odd image), skip
  if (rs.length < 20) return { gainR: 1, gainG: 1, gainB: 1 };

  const medR = median(rs), medG = median(gs), medB = median(bs);
  const clamp = (v) => Math.min(1.6, Math.max(0.6, v));
  return {
    gainR: clamp(TARGET_WHITE / medR),
    gainG: clamp(TARGET_WHITE / medG),
    gainB: clamp(TARGET_WHITE / medB),
  };
}

// ── Stage 2: build coarse luminance grid for local shade correction ───────────
// Grid of SHADE_GRID × SHADE_GRID cells.  Each cell stores the average
// luminance of white-balanced pixels inside it.  During per-pixel correction
// we look up the cell and scale: factor = globalAvgLum / cellAvgLum.
const SHADE_GRID = 8;

function buildShadeGrid(data, width, height, gains) {
  const cellW = width / SHADE_GRID;
  const cellH = height / SHADE_GRID;
  const sums = new Float64Array(SHADE_GRID * SHADE_GRID);
  const counts = new Uint32Array(SHADE_GRID * SHADE_GRID);
  const step = 2; // sample every 2nd pixel

  for (let y = 0; y < height; y += step) {
    const gy = Math.min(Math.floor(y / cellH), SHADE_GRID - 1);
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      // Apply white-balance gains first, then measure luminance
      const r = Math.min(255, data[i] * gains.gainR);
      const g = Math.min(255, data[i + 1] * gains.gainG);
      const b = Math.min(255, data[i + 2] * gains.gainB);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const gx = Math.min(Math.floor(x / cellW), SHADE_GRID - 1);
      const idx = gy * SHADE_GRID + gx;
      sums[idx] += lum;
      counts[idx]++;
    }
  }

  // Compute per-cell average and the global average
  const cellAvg = new Float64Array(SHADE_GRID * SHADE_GRID);
  let globalSum = 0, globalCount = 0;
  for (let i = 0; i < sums.length; i++) {
    cellAvg[i] = counts[i] > 0 ? sums[i] / counts[i] : 128;
    globalSum += sums[i];
    globalCount += counts[i];
  }
  const globalAvg = globalCount > 0 ? globalSum / globalCount : 128;

  return { cellAvg, globalAvg, cellW, cellH };
}

// ─── LIGHTING CHECK ───────────────────────────────────────────────────────────
// Thresholds tuned for typical indoor bathroom lighting on a phone camera.
// Luminance per pixel = 0.299R + 0.587G + 0.114B  (ITU-R BT.601)
// We sample only the central 60×60 % of the frame to ignore dark edges / borders.
const LIGHT_DIM_MAX = 38;   // avg luminance below this → too dim
const LIGHT_BRIGHT_MIN = 220; // avg luminance above this → too bright

function measureBrightness(videoEl, scratchCanvas) {
  if (!videoEl || videoEl.readyState < videoEl.HAVE_ENOUGH_DATA) return null;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return null;

  // Define the central 60 % crop
  const cropX = vw * 0.2, cropY = vh * 0.2;
  const cropW = vw * 0.6, cropH = vh * 0.6;

  scratchCanvas.width = cropW;
  scratchCanvas.height = cropH;
  const ctx = scratchCanvas.getContext("2d");
  ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const imageData = ctx.getImageData(0, 0, cropW, cropH);
  const d = imageData.data;
  let sum = 0, count = 0;
  // Sample every 4th pixel for speed
  for (let i = 0; i < d.length; i += 16) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    count++;
  }
  const avg = sum / count;

  if (avg < LIGHT_DIM_MAX) return { status: "dim", value: avg };
  if (avg > LIGHT_BRIGHT_MIN) return { status: "bright", value: avg };
  return { status: "ok", value: avg };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function matchesBlood(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  for (const p of BLOOD_PROFILES) {
    const hMatch = p.hMin <= p.hMax
      ? h >= p.hMin && h <= p.hMax
      : h >= p.hMin || h <= p.hMax;
    if (hMatch && s >= p.sMin && s <= p.sMax && l >= p.lMin && l <= p.lMax) {
      return p;
    }
  }
  return null;
}

// ─── CLUSTER NEARBY BLOOD PIXELS INTO BOUNDING BOXES ─────────────────────────
function clusterDetections(pixels, width, height) {
  const GRID = 12; // cluster grid cell size in px
  const gridW = Math.ceil(width / GRID);
  const gridH = Math.ceil(height / GRID);
  const grid = new Array(gridW * gridH).fill(null).map(() => ({ count: 0, profiles: {} }));

  pixels.forEach(({ x, y, profile }) => {
    const gx = Math.floor(x / GRID), gy = Math.floor(y / GRID);
    const cell = grid[gy * gridW + gx];
    cell.count++;
    cell.profiles[profile.label] = (cell.profiles[profile.label] || 0) + 1;
  });

  // Merge adjacent cells with enough signal into bounding boxes
  const visited = new Set();
  const boxes = [];
  const THRESHOLD = 3; // min pixels in a cell to count

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const idx = gy * gridW + gx;
      if (visited.has(idx) || grid[idx].count < THRESHOLD) continue;
      // BFS flood fill to find connected cluster
      const queue = [idx];
      visited.add(idx);
      let minX = gx, maxX = gx, minY = gy, maxY = gy;
      let totalPixels = 0;
      const profileTotals = {};
      while (queue.length) {
        const ci = queue.shift();
        const cx = ci % gridW, cy = Math.floor(ci / gridW);
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        totalPixels += grid[ci].count;
        Object.entries(grid[ci].profiles).forEach(([k, v]) => {
          profileTotals[k] = (profileTotals[k] || 0) + v;
        });
        // Check 4 neighbors
        const neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
        neighbors.forEach(([nx, ny]) => {
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return;
          const ni = ny * gridW + nx;
          if (!visited.has(ni) && grid[ni].count >= THRESHOLD) {
            visited.add(ni);
            queue.push(ni);
          }
        });
      }
      if (totalPixels < 8) continue; // filter noise
      // Dominant profile
      const dominant = Object.entries(profileTotals).sort((a,b) => b[1]-a[1])[0];
      const prof = BLOOD_PROFILES.find(p => p.label === dominant[0]);
      boxes.push({
        x: minX * GRID, y: minY * GRID,
        w: (maxX - minX + 1) * GRID, h: (maxY - minY + 1) * GRID,
        label: prof.label, color: prof.color, severity: prof.severity, pixels: totalPixels
      });
    }
  }
  return boxes;
}

// ─── ANALYZE IMAGE DATA (with correction) ────────────────────────────────────
// Pipeline per pixel:
//   raw R,G,B  →  × white-balance gains  →  × shade scale factor  →  matchesBlood()
function analyzeImageData(imageData, width, height) {
  const data = imageData.data;

  // ── Stage 1: global white-balance gains (computed once for the whole image) ──
  const gains = computeWhiteBalanceGains(data, width, height);

  // ── Stage 2: coarse shade grid (computed once, looked up per pixel) ──
  const shade = buildShadeGrid(data, width, height, gains);

  // ── Per-pixel loop: correct → match ──
  const bloodPixels = [];
  for (let y = 0; y < height; y += 2) {
    // Shade grid row for this y
    const gy = Math.min(Math.floor(y / shade.cellH), SHADE_GRID - 1);

    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 128) continue;

      // Raw pixel
      const rawR = data[i], rawG = data[i + 1], rawB = data[i + 2];

      // Stage 1: white-balance
      let r = rawR * gains.gainR;
      let g = rawG * gains.gainG;
      let b = rawB * gains.gainB;

      // Stage 2: shade correction
      const gx = Math.min(Math.floor(x / shade.cellW), SHADE_GRID - 1);
      const cellLum = shade.cellAvg[gy * SHADE_GRID + gx];
      // scale = globalAvg / cellAvg, clamped to [0.7, 1.5]
      const shadeFactor = Math.min(1.5, Math.max(0.7, shade.globalAvg / (cellLum || 1)));
      r *= shadeFactor;
      g *= shadeFactor;
      b *= shadeFactor;

      // Clamp to [0, 255]
      r = Math.min(255, Math.max(0, r));
      g = Math.min(255, Math.max(0, g));
      b = Math.min(255, Math.max(0, b));

      // Blood match on corrected values
      const profile = matchesBlood(r, g, b);
      if (profile) bloodPixels.push({ x, y, profile });
    }
  }
  return clusterDetections(bloodPixels, width, height);
}

// ─── SEVERITY LEGEND INFO ─────────────────────────────────────────────────────
const SEVERITY_INFO = {
  urgent: { icon: "🔴", title: "Urgent", desc: "Bright or dark red blood may indicate bleeding in the urinary or lower digestive tract. Consult a doctor promptly." },
  warning: { icon: "🟠", title: "Warning", desc: "Maroon or brown coloring may indicate blood that has been partially digested, possibly from the upper GI tract." },
  caution: { icon: "⚫", title: "Caution", desc: "Very dark or tarry (black) stool may indicate upper GI bleeding (melena). Medical evaluation is recommended." },
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function HealthScanApp() {
  const [phase, setPhase] = useState("home"); // home | camera | scanning | results
  const [imageUrl, setImageUrl] = useState(null);
  const [detections, setDetections] = useState([]);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [lightingStatus, setLightingStatus] = useState(null); // { status: "dim"|"ok"|"bright", value }
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const scratchCanvasRef = useRef(null); // off-screen canvas for brightness sampling
  const streamRef = useRef(null);
  const lightingIntervalRef = useRef(null);
  const imgRef = useRef(null);

  // ── Start camera ──
  // Step 1: acquire the stream, store it, then flip phase so <video> mounts.
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      streamRef.current = stream;
      setPhase("camera"); // triggers re-render → <video> appears in DOM
    } catch (e) {
      alert("Camera access denied or unavailable. Please enable camera permissions.");
    }
  }, []);

  // ── Step 2: once <video> is in the DOM, wire the stream ──
  useEffect(() => {
    if (phase !== "camera" || !streamRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = streamRef.current;
    // .play() returns a promise on mobile; await it so errors don't go silent
    video.play().catch((err) => console.warn("[camera] play() failed:", err));
  }, [phase]);

  // ── Stop camera ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Capture snapshot ──
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    setImageUrl(url);
    setImgDims({ w, h });
    stopCamera();
    setPhase("scanning");
  }, [stopCamera]);

  // ── Poll lighting while camera is live ──
  useEffect(() => {
    if (phase !== "camera") {
      clearInterval(lightingIntervalRef.current);
      lightingIntervalRef.current = null;
      setLightingStatus(null);
      return;
    }
    // Create a persistent off-screen canvas for brightness sampling
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement("canvas");
    }
    const tick = () => {
      const result = measureBrightness(videoRef.current, scratchCanvasRef.current);
      if (result) setLightingStatus(result);
    };
    tick(); // immediate first read
    lightingIntervalRef.current = setInterval(tick, 600);
    return () => { clearInterval(lightingIntervalRef.current); lightingIntervalRef.current = null; };
  }, [phase]);

  // ── Run analysis when scanning ──
  useEffect(() => {
    if (phase !== "scanning" || !imageUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      // Simulate brief scanning delay for UX
      setTimeout(() => {
        const results = analyzeImageData(imageData, img.width, img.height);
        setDetections(results);
        setPhase("results");
      }, 1400);
    };
    img.src = imageUrl;
  }, [phase, imageUrl]);

  // ── Draw overlay on results ──
  useEffect(() => {
    if (phase !== "results" || !imageUrl || !overlayCanvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = overlayCanvasRef.current;
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      detections.forEach(box => {
        const pad = 6;
        const rx = box.x - pad, ry = box.y - pad;
        const rw = box.w + pad * 2, rh = box.h + pad * 2;
        // Semi-transparent fill
        ctx.fillStyle = box.color + "44";
        ctx.fillRect(rx, ry, rw, rh);
        // Border
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        // Label background
        const fontSize = Math.max(14, img.width * 0.022);
        ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
        const labelText = `${box.label} (${box.pixels}px)`;
        const tw = ctx.measureText(labelText).width + 16;
        const th = fontSize + 10;
        const ly = ry - th - 4 < 0 ? ry + rh + 4 : ry - th - 4;
        ctx.fillStyle = "#111827ee";
        ctx.beginPath();
        ctx.roundRect(rx, ly, tw, th, 6);
        ctx.fill();
        // Label text
        ctx.fillStyle = box.color;
        ctx.fillText(labelText, rx + 8, ly + fontSize + 2);
      });
    };
    img.src = imageUrl;
  }, [phase, imageUrl, detections]);

  const reset = () => { setImageUrl(null); setDetections([]); setPhase("home"); };

  // ── Cleanup on unmount / phase change ──
  useEffect(() => { return () => stopCamera(); }, [stopCamera]);

  // Highest severity found
  const highestSeverity = detections.length
    ? (detections.some(d => d.severity === "urgent") ? "urgent" : detections.some(d => d.severity === "warning") ? "warning" : "caution")
    : null;

  // ── Derived values for camera phase (computed in body, not in an IIFE) ──
  const cameraDerived = {
    canCapture: !lightingStatus || lightingStatus.status === "ok",
    lightColor: !lightingStatus ? "#64748b" : lightingStatus.status === "ok" ? "#22c55e" : "#f59e0b",
    lightIcon: !lightingStatus ? "…" : lightingStatus.status === "ok" ? "☀️" : lightingStatus.status === "dim" ? "🌑" : "💡",
    lightMsg: !lightingStatus ? "Checking lighting…"
      : lightingStatus.status === "dim" ? "Too dim — brighten the light"
      : lightingStatus.status === "bright" ? "Too bright — reduce direct light"
      : "Lighting OK",
    barPct: lightingStatus ? Math.round((lightingStatus.value / 255) * 100) : 50,
  };

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ── HOME ── */}
      {phase === "home" && (
        <div style={styles.screen}>
          <div style={styles.homeIcon}>
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
              <circle cx="36" cy="36" r="34" stroke="#22c55e" strokeWidth="2.5" fill="none" strokeDasharray="60 150" strokeLinecap="round" style={{ transform: "rotate(-30deg)", transformOrigin: "center" }} />
              <circle cx="36" cy="36" r="24" fill="#1e293b" />
              <path d="M28 36 L33 41 L44 30" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <h1 style={styles.homeTitle}>HealthScan</h1>
          <p style={styles.homeSub}>Toilet health monitoring via blood detection in urine & stool</p>
          <div style={styles.infoCard}>
            <p style={styles.infoText}>
              This app scans for signs of blood — ranging from <span style={{ color: "#ef4444" }}>bright red</span> to <span style={{ color: "#9ca3af" }}>black</span> — which may indicate urinary or colorectal conditions.
            </p>
            <p style={{ ...styles.infoText, marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              ⚕️ This is a screening aid only. Always consult a healthcare professional for diagnosis.
            </p>
          </div>
          <button style={styles.primaryBtn} onClick={startCamera}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            Start Scan
          </button>
        </div>
      )}

      {/* ── CAMERA ── */}
      {phase === "camera" && (
          <div style={styles.screen}>
            <div style={styles.cameraContainer}>
              <video ref={videoRef} style={styles.video} playsInline autoPlay muted />
              {/* Viewfinder corners */}
              <div style={styles.viewfinder}>
                <div style={styles.corner("top-left")} />
                <div style={styles.corner("top-right")} />
                <div style={styles.corner("bottom-left")} />
                <div style={styles.corner("bottom-right")} />
              </div>
              {/* Lighting indicator bar — sits at the top of the viewfinder */}
              <div style={styles.lightingBar}>
                <span style={{ fontSize: 14 }}>{cameraDerived.lightIcon}</span>
                <div style={styles.lightingTrack}>
                  <div style={styles.zoneMarkerLeft}>dim</div>
                  <div style={styles.zoneMarkerRight}>bright</div>
                  <div style={styles.lightingTrackBg} />
                  <div style={{ ...styles.lightingFill, width: `${cameraDerived.barPct}%`, background: cameraDerived.lightColor, boxShadow: `0 0 6px ${cameraDerived.lightColor}88` }} />
                  <div style={{ ...styles.lightingThumb, left: `calc(${cameraDerived.barPct}% - 6px)`, borderColor: cameraDerived.lightColor }} />
                </div>
                <span style={{ ...styles.lightingLabel, color: cameraDerived.lightColor }}>{cameraDerived.lightMsg}</span>
              </div>
              {/* Bottom hint */}
              <div style={styles.cameraHint}>Point at the toilet bowl</div>
            </div>
            <div style={styles.cameraActions}>
              <button style={styles.cancelBtn} onClick={() => { stopCamera(); setPhase("home"); }}>Cancel</button>
              <button
                style={{ ...styles.captureBtn, ...(cameraDerived.canCapture ? {} : styles.captureBtnDisabled) }}
                onClick={cameraDerived.canCapture ? capture : undefined}
                disabled={!cameraDerived.canCapture}
              >
                <div style={{ ...styles.captureInner, ...(cameraDerived.canCapture ? {} : { background: "#475569" }) }} />
              </button>
              <div style={{ width: 56 }} />
            </div>
            {/* Persistent warning text below buttons when lighting is bad */}
            {!cameraDerived.canCapture && (
              <p style={styles.lightingWarning}>
                {lightingStatus.status === "dim"
                  ? "Move closer to a light source or turn on the bathroom light."
                  : "Step back or turn off direct overhead light to reduce glare."}
              </p>
            )}
          </div>
      )}

      {/* ── SCANNING ── */}
      {phase === "scanning" && (
        <div style={styles.screen}>
          <div style={styles.scanPreview}>
            <img src={imageUrl} alt="scan" style={styles.previewImg} />
            <div style={styles.scanOverlay}>
              <div style={styles.scanLine} />
            </div>
          </div>
          <div style={styles.scanStatus}>
            <div style={styles.pulser} />
            <span style={styles.scanText}>Analyzing for blood markers…</span>
          </div>
        </div>
      )}

      {/* ── RESULTS ── */}
      {phase === "results" && (
        <div style={styles.screen}>
          <div style={styles.resultsHeader}>
            <button style={styles.backBtn} onClick={reset}>← Back</button>
            <span style={styles.resultsTitle}>Scan Results</span>
          </div>
          <div style={styles.resultImageWrap}>
            <canvas ref={overlayCanvasRef} style={styles.resultCanvas} />
          </div>

          {detections.length === 0 ? (
            <div style={styles.cleanCard}>
              <div style={styles.cleanIcon}>✓</div>
              <p style={styles.cleanTitle}>No blood detected</p>
              <p style={styles.cleanSub}>No signs of blood were found in this scan. Continue monitoring regularly.</p>
            </div>
          ) : (
            <>
              {/* Summary badge */}
              <div style={{ ...styles.summaryBadge, borderColor: highestSeverity === "urgent" ? "#ef4444" : highestSeverity === "warning" ? "#f59e0b" : "#6b7280" }}>
                <span style={styles.summaryLabel}>
                  {SEVERITY_INFO[highestSeverity].icon} {detections.length} detection{detections.length > 1 ? "s" : ""} — {SEVERITY_INFO[highestSeverity].title}
                </span>
              </div>

              {/* Detection list */}
              <div style={styles.detectionList}>
                {detections.map((d, i) => (
                  <div key={i} style={styles.detectionCard}>
                    <div style={{ ...styles.detectionDot, background: d.color }} />
                    <div style={styles.detectionInfo}>
                      <span style={{ ...styles.detectionLabel, color: d.color }}>{d.label}</span>
                      <span style={styles.detectionMeta}>{d.pixels} matching pixels detected</span>
                    </div>
                    <span style={{ ...styles.severityTag, background: d.severity === "urgent" ? "#7f1d1d33" : d.severity === "warning" ? "#78350f33" : "#1f293633", color: d.severity === "urgent" ? "#fca5a5" : d.severity === "warning" ? "#fcd34d" : "#9ca3af" }}>
                      {d.severity}
                    </span>
                  </div>
                ))}
              </div>

              {/* Medical note */}
              <div style={styles.medicalNote}>
                <p style={styles.medicalTitle}>⚕️ What this may indicate</p>
                <p style={styles.medicalText}>{SEVERITY_INFO[highestSeverity].desc}</p>
                <p style={{ ...styles.medicalText, marginTop: 6, fontStyle: "italic", color: "#6b7280" }}>
                  This tool is for screening only. Please consult a healthcare professional for proper diagnosis and treatment.
                </p>
              </div>

              <button style={styles.primaryBtn} onClick={reset}>New Scan</button>
            </>
          )}
        </div>
      )}

      {/* ── SCAN LINE ANIMATION ── */}
      <style>{`
        @keyframes scanSlide {
          0% { top: 0%; }
          100% { top: 100%; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .scan-line-anim {
          animation: scanSlide 1.2s linear infinite;
        }
        .pulser-anim {
          animation: pulse 1s ease-in-out infinite;
        }
        .fade-in {
          animation: fadeIn 0.4s ease;
        }
      `}</style>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh", background: "#0f172a", color: "#f1f5f9",
    fontFamily: "'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center",
  },
  screen: {
    width: "100%", maxWidth: 480, minHeight: "100vh",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "40px 20px 32px", gap: 20, boxSizing: "border-box",
  },

  // HOME
  homeIcon: { marginTop: 24 },
  homeTitle: { fontSize: 32, fontWeight: 700, letterSpacing: -0.5, color: "#f8fafc", margin: 0 },
  homeSub: { fontSize: 14, color: "#64748b", textAlign: "center", margin: 0, maxWidth: 280, lineHeight: 1.5 },
  infoCard: {
    background: "#1e293b", borderRadius: 14, padding: "16px 18px",
    border: "1px solid #334155", width: "100%", boxSizing: "border-box",
  },
  infoText: { margin: 0, fontSize: 13.5, color: "#94a3b8", lineHeight: 1.6 },

  // BUTTONS
  primaryBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, #16a34a, #15803d)", color: "#fff",
    border: "none", borderRadius: 14, padding: "14px 32px", fontSize: 16,
    fontWeight: 600, cursor: "pointer", width: "100%", maxWidth: 320,
    boxShadow: "0 4px 20px #16a34a44", transition: "transform 0.15s, box-shadow 0.15s",
  },
  cancelBtn: {
    background: "transparent", color: "#64748b", border: "1px solid #334155",
    borderRadius: 10, padding: "8px 18px", fontSize: 14, cursor: "pointer",
  },

  // CAMERA
  cameraContainer: {
    width: "100%", position: "relative", borderRadius: 16, overflow: "hidden",
    background: "#1e293b", border: "1px solid #334155", aspectRatio: "4/3",
  },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  viewfinder: { position: "absolute", inset: "12%", pointerEvents: "none" },
  corner: (pos) => {
    const base = { position: "absolute", width: 24, height: 24, borderColor: "#22c55e", borderStyle: "solid" };
    const map = {
      "top-left": { top: 0, left: 0, borderWidth: "2px 0 0 2px", borderRadius: "4px 0 0 0" },
      "top-right": { top: 0, right: 0, borderWidth: "2px 2px 0 0", borderRadius: "0 4px 0 0" },
      "bottom-left": { bottom: 0, left: 0, borderWidth: "0 0 2px 2px", borderRadius: "0 0 0 4px" },
      "bottom-right": { bottom: 0, right: 0, borderWidth: "0 2px 2px 0", borderRadius: "0 0 4px 0" },
    };
    return { ...base, ...map[pos] };
  },
  cameraHint: {
    position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
    background: "#00000099", color: "#fff", fontSize: 13, padding: "5px 14px",
    borderRadius: 20, whiteSpace: "nowrap", fontWeight: 500,
  },
  cameraActions: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 320 },
  captureBtn: {
    width: 68, height: 68, borderRadius: "50%", border: "3px solid #fff",
    background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 0 2px #22c55e",
  },
  captureInner: { width: 52, height: 52, borderRadius: "50%", background: "#22c55e" },

  // SCANNING
  scanPreview: { width: "100%", position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid #334155" },
  previewImg: { width: "100%", display: "block" },
  scanOverlay: { position: "absolute", inset: 0, pointerEvents: "none" },
  scanLine: {
    position: "absolute", left: 0, right: 0, height: 3,
    background: "linear-gradient(90deg, transparent, #22c55e, transparent)",
    boxShadow: "0 0 12px #22c55e88",
    animation: "scanSlide 1.2s linear infinite",
  },
  scanStatus: { display: "flex", alignItems: "center", gap: 10, marginTop: 8 },
  pulser: { width: 12, height: 12, borderRadius: "50%", background: "#22c55e", animation: "pulse 1s ease-in-out infinite" },
  scanText: { fontSize: 14, color: "#22c55e", fontWeight: 500 },

  // RESULTS
  resultsHeader: { display: "flex", alignItems: "center", width: "100%", gap: 12 },
  backBtn: { background: "none", border: "none", color: "#64748b", fontSize: 14, cursor: "pointer", padding: 0 },
  resultsTitle: { fontSize: 16, fontWeight: 600, color: "#94a3b8" },
  resultImageWrap: { width: "100%", borderRadius: 14, overflow: "hidden", border: "1px solid #334155" },
  resultCanvas: { width: "100%", display: "block" },

  // CLEAN
  cleanCard: {
    background: "#1e293b", border: "1px solid #166534", borderRadius: 16,
    padding: "28px 24px", textAlign: "center", width: "100%", boxSizing: "border-box",
  },
  cleanIcon: { fontSize: 36, color: "#22c55e", marginBottom: 8 },
  cleanTitle: { margin: 0, fontSize: 18, fontWeight: 600, color: "#f1f5f9" },
  cleanSub: { margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 },

  // DETECTIONS
  summaryBadge: {
    background: "#1e293b", border: "1px solid", borderRadius: 10, padding: "8px 16px", width: "100%", boxSizing: "border-box",
  },
  summaryLabel: { fontSize: 14, fontWeight: 600, color: "#e2e8f0" },
  detectionList: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
  detectionCard: {
    display: "flex", alignItems: "center", gap: 12,
    background: "#1e293b", borderRadius: 10, padding: "10px 14px", border: "1px solid #334155",
  },
  detectionDot: { width: 14, height: 14, borderRadius: "50%", flexShrink: 0 },
  detectionInfo: { display: "flex", flexDirection: "column", flex: 1 },
  detectionLabel: { fontSize: 14, fontWeight: 600 },
  detectionMeta: { fontSize: 11.5, color: "#64748b" },
  severityTag: { fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: 0.5 },

  // LIGHTING BAR (inside camera viewfinder)
  lightingBar: {
    position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
    background: "#00000088", borderRadius: 10, padding: "8px 14px",
    zIndex: 2, minWidth: 200, pointerEvents: "none",
  },
  lightingTrack: {
    width: "100%", height: 6, position: "relative", display: "flex", alignItems: "center",
  },
  lightingTrackBg: {
    position: "absolute", inset: 0, borderRadius: 3,
    background: "linear-gradient(90deg, #1e293b 0%, #334155 20%, #475569 50%, #334155 80%, #1e293b 100%)",
  },
  lightingFill: {
    position: "absolute", top: 0, left: 0, height: "100%", borderRadius: 3,
    transition: "width 0.4s ease, background 0.4s ease, box-shadow 0.4s ease",
  },
  lightingThumb: {
    position: "absolute", top: -4, width: 14, height: 14, borderRadius: "50%",
    background: "#0f172a", border: "2px solid", transition: "left 0.4s ease, border-color 0.4s ease",
    zIndex: 1,
  },
  zoneMarkerLeft: {
    position: "absolute", left: 0, top: -16, fontSize: 9, color: "#64748b", fontWeight: 600, letterSpacing: 0.5,
  },
  zoneMarkerRight: {
    position: "absolute", right: 0, top: -16, fontSize: 9, color: "#64748b", fontWeight: 600, letterSpacing: 0.5,
  },
  lightingLabel: {
    fontSize: 11.5, fontWeight: 600, transition: "color 0.3s ease", letterSpacing: 0.3,
  },
  lightingWarning: {
    margin: 0, fontSize: 12.5, color: "#fbbf24", textAlign: "center",
    maxWidth: 280, lineHeight: 1.5, fontWeight: 500,
    background: "#451a0333", border: "1px solid #78350f55", borderRadius: 8,
    padding: "8px 12px",
  },

  // CAPTURE BUTTON DISABLED
  captureBtnDisabled: {
    opacity: 0.4, cursor: "not-allowed", boxShadow: "0 0 0 2px #475569",
  },

  // MEDICAL NOTE
  medicalNote: {
    background: "#1e293b", border: "1px solid #475569", borderRadius: 12,
    padding: "14px 16px", width: "100%", boxSizing: "border-box",
  },
  medicalTitle: { margin: 0, fontSize: 13, fontWeight: 600, color: "#cbd5e1" },
  medicalText: { margin: "6px 0 0", fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 },
};
