# HealthScan release checklist

The static check (`npm run release:check`) verifies repository readiness only. It does not simulate camera permissions or claim real-device coverage.

## Clinical and product gate

- [ ] Clinician-reviewed, consented, de-identified validation dataset completed.
- [ ] Dual review, adjudication, inclusion/exclusion rules, and thresholds locked before unblinding.
- [ ] Sensitivity, specificity, PPV, NPV, inconclusive rate, and Wilson 95% CIs reported overall and by the predefined strata.
- [ ] No medical positioning or accuracy claim is published before clinician/regulatory review.
- [ ] Non-diagnostic urgent-care copy reviewed for each supported locale.

## iOS Safari device lab

- [ ] First-time camera allow works.
- [ ] Deny, revoke in Settings, and retry flows are understandable.
- [ ] Rear camera preview, framing controls, preflight warnings, and capture work.
- [ ] Background/resume stops and safely restarts camera tracks.
- [ ] Home Screen PWA launch, offline reload after first visit, photo fallback, exports, and share behavior work.
- [ ] VoiceOver announces headings, checklist state, sliders, results, errors, and focus transitions.

## Android Chrome device lab

- [ ] First-time camera allow works.
- [ ] Deny, revoke in site settings, and retry flows are understandable.
- [ ] Rear camera preview, framing controls, preflight warnings, and capture work.
- [ ] Background/resume stops and safely restarts camera tracks.
- [ ] Installed PWA launch, offline reload after first visit, photo fallback, exports, and share behavior work.
- [ ] TalkBack announces headings, checklist state, sliders, results, errors, and focus transitions.

## Privacy and security

- [ ] Encrypted history setup, unlock, lock, migration, wrong-passcode, unavailable-WebCrypto, and reset flows tested.
- [ ] No passcode, derived key, or scan image is persisted.
- [ ] Legacy plaintext history is removed only after successful encrypted writes.
- [ ] Reset confirmation and deletion behavior are documented.
- [ ] Storage contents are treated as untrusted and malformed records are ignored safely.
- [ ] Photo-free feedback contains no image, timestamp, sample type, detection, or health result.

## Accessibility, performance, and regression

- [ ] Normal/large/extra-large text and standard/high contrast settings work with keyboard and assistive technology.
- [ ] Results communicate meaning with text and status, not color alone.
- [ ] `npm test`, `npm run build`, and `npm run release:check` pass.
- [ ] Scan processing remains in the worker where available; benchmark scan latency and bundle size against the prior release.
- [ ] Browser smoke test has no uncaught console errors.
