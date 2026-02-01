# BloodCheck — Changelog

## v1.1.0 — Major Update
*Released January 2026*

---

### 🎨 Visual Identity & Logo
- **New logo** — a droplet-shaped icon featuring a magnifying glass and amber discovery dot, conveying both health monitoring and careful investigation. Appears on the Home page and the Scan Results page header.
- Unified blue accent palette (`#2563eb`) across primary actions, scan animation, and capture button for visual consistency.

---

### ♿ Colorblind Accessibility (Full Redesign)
- **Removed all colour-only indicators.** Every detection now communicates via three independent channels simultaneously:
  - **Shape** — ▲ (triangle) for "look into", ◆ (diamond) for "monitor", ● (circle) for "keep watch".
  - **Hatch pattern** — vertical lines, diagonal lines, or dots drawn over each detection region on both the full annotated image and cropped thumbnails.
  - **Text label** — every finding includes a plain-language severity label.
- **Colorblind-safe palette** — blue (`#60a5fa`), orange (`#fb923c`), and purple (`#c084fc`) chosen to remain distinguishable under protanopia, deuteranopia, and tritanopia.
- Detection overlay hatching is drawn on the canvas at export time, so saved images carry the accessibility information too.

---

### 📷 Camera Improvements
- **Larger live view** — the camera viewport now uses `flex: 1` to fill available vertical space (capped at 70 vh), giving a substantially bigger preview on all screen sizes.
- **Toilet-bowl framing guide** — a dashed ellipse SVG overlay with instructional text ("Centre the toilet bowl inside the oval") and a distance hint ("Hold about 30–40 cm away to reduce your shadow") helps users frame the shot optimally. The 30–40 cm distance balances image detail against shadow cast by the user's hand and phone.
- **Compact brightness indicator** — the previous full-width lighting bar with labels has been replaced by a small pill (icon + 32 px bar) pinned to the top-right corner, freeing up viewfinder space.
- **Flash / torch toggle** — a new button in the top-left corner lets users turn the device torch on or off. The white-balance pipeline automatically switches to a higher target white (250 vs 240) when flash is active, compensating for the over-exposure flash causes on white porcelain.

---

### 🔬 Detection & Classification
- **Pee vs. stool sample detection** — a new classifier samples the central 40 % of the corrected image. It measures average luminance and saturation after colour correction: high luminance + low saturation → urine; otherwise → stool. The classification is shown on the Results page and used to tailor diagnostic guidance text.
- **Flash-aware white balance** — `computeWhiteBalanceGains` now accepts a `flashIsOn` flag. When the torch was on during capture, the target neutral white rises to 250 to account for the brighter porcelain the flash produces.

---

### 📋 Scan Results — Tone & Layout Overhaul
- **New disclaimer banner** at the very top of the Results page (above the image), clearly stating these results are informational only.
- **Approachable language throughout:**
  - "Urgent" → *"Something to look into"*
  - "Warning" → *"Worth keeping an eye on"*
  - "Caution" → *"Worth a mention to your doctor"*
  - All descriptions rewritten in calm, non-alarming prose that guides the user toward next steps without causing unnecessary anxiety.
- **Sample-type-specific guidance** — each severity level now shows advice tailored to whether the sample was urine or stool.
- **Collapsible findings section** — detection details are hidden by default behind a "▸ Show details" toggle. This keeps the initial view reassuring (summary only) while still giving full information on demand.
- **Cropped thumbnails** — each finding, when expanded, includes a zoomed crop of the detected area with the colorblind hatch overlay, so the user can see exactly what was flagged.

---

### 💾 Save, Export & Share
- **Save photo** — tapping "💾 Save" downloads a watermarked PNG. On mobile this triggers the native share sheet, allowing the user to save directly to their photo gallery.
- **Export menu** — "📤 Export" opens a sub-menu:
  - *As Image* — watermarked PNG (same as Save).
  - *As PDF* — a hand-assembled PDF containing the watermarked annotated image plus a text header with app name, date, sample type, findings summary, disclaimer, and MIT notice. The JPEG image is embedded directly in the PDF stream.
- **Email** — "✉️ Email" saves the scan image first (for manual attachment), then opens the device's default email client with a pre-filled subject line (`BloodCheck Scan Results – [date]`) and a structured plain-text body summarising the findings.
- **Watermark contents** (on all exports):
  - App name (BloodCheck)
  - Date & time the photo was taken
  - Sample type
  - A QR code block pattern linking to the GitHub repository
  - Disclaimer text
  - MIT license notice

---

### 📖 About Page
- New page accessible via the **ⓘ** button on the Home screen.
- States the research inspiration: *Impact of colour vision deficiency on bladder and colorectal cancer survival* with a direct link to the Nature paper.
- Explains the colorblind-accessibility design decisions.
- Links to the GitHub repository.
- Includes the full MIT license text.

---

### ⚖️ Legal & License
- **MIT license notice** added as a footer on every page (Home, Camera, Results, About).
- Full MIT license text included on the About page.

---

### 🛠 Technical Notes
- Crop thumbnails are generated synchronously inside the overlay `useEffect` (after the annotated canvas is drawn) and stored in React state (`cropUrls`), avoiding the race condition that async `Image.onload` would cause.
- The PDF export assembles a valid PDF structure with a proper image XObject stream. Byte offsets in the xref table are approximate; modern PDF readers handle this gracefully.
- The QR pattern is a seeded block matrix (finder patterns + text-seeded data cells). It is visually distinct per URL but is not a spec-compliant scannable QR code — a production release should swap in a proper QR encoder library.
