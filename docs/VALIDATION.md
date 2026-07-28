# Validation and release gates

HealthScan identifies colour patterns only. Do not market or release it as a diagnostic or medical device until the following gates have been completed and documented.

## Clinical validation

1. Obtain ethics/privacy approval and a clinician-reviewed, consented image dataset with confirmed ground truth.
2. Include negative controls and confounders: menstrual blood, cleaning products, food/medication colour changes, varied toilet materials, and varied lighting.
3. Stratify results by phone camera, operating system, skin/lighting environment where relevant, sample type, and colour profile.
4. Predefine sensitivity, specificity, false-positive rate, false-negative rate, and an inconclusive-rate target before evaluating the model.
5. Have independent clinicians review the labelling protocol, thresholds, participant-facing copy, and release decision.

## Real-device camera matrix

Run this matrix on every release candidate over HTTPS, including installed PWA mode:

| Platform | Browser | Required cases |
| --- | --- | --- |
| iPhone/iPad | Safari | First-time allow, deny, revoke-and-retry, rear camera, background/resume, Home Screen launch, photo upload, offline reload |
| Android phone/tablet | Chrome | First-time allow, deny, revoke-and-retry, rear camera, background/resume, installed PWA launch, photo upload, offline reload |

For each case, record camera start time, capture success, whether the framing mask matches the saved image, quality warnings, result rendering, export/share behavior, and console errors.

## VoiceOver and TalkBack audit

Run the complete home → camera → capture/upload → results → export path with VoiceOver on iOS and TalkBack on Android. Confirm:

- All controls have useful spoken names, state, and purpose.
- Focus moves to the current screen after phase transitions and does not become trapped.
- The scan image has a meaningful text alternative and results do not depend only on colour.
- Range controls announce their current framing value.
- Toasts and quality/error states are announced once without interrupting critical controls.
- Large text, increased contrast, and reduced motion preserve a usable layout.

## Secure-history decision

The current optional history is summary-only and contains no images, but browser `localStorage` is not encrypted or protected by an app passcode. Before storing health-related history for a public release, replace it with an encrypted IndexedDB design:

1. Derive an in-memory AES-GCM key from a user-selected passcode using PBKDF2 with a per-device random salt.
2. Store only encrypted records and random IVs in IndexedDB; never persist the passcode or derived key.
3. Require the passcode once per app session and provide a clear warning that passcode reset deletes the encrypted history.
4. Add migration and deletion flows for existing legacy storage, then have the design independently security-reviewed.

## Photo-free quality feedback

The app can export an optional feedback JSON file containing app version, capture source, quality state, quality reasons, and the user’s usefulness rating. It intentionally excludes images, timestamps, sample type, detections, and health results. Any future upload endpoint requires separate consent language, data-retention limits, and a privacy review.
