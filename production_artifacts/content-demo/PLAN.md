# Launch: Pulse show-control app

Fictional demo plan for a screen recording. Everything here is invented.

## Brand and site {#brand-site}
needs: [core-engine]
files: [site/**]

- [x] Logo and colour palette locked {#logo-palette}
  by: agy
  tech: site/brand/tokens.json
- [ ] Landing page hero with live demo loop {#landing-hero}
  by: agy
- [ ] Pricing and download page {#pricing-page}
  by: opencode
- [ ] Launch announcement copy {#launch-copy}
  by: claude

## Core engine {#core-engine}
files: [src/engine/**]

- [x] Cue timeline data model {#cue-model}
  by: claude
  tech: src/engine/cues.ts
- [ ] Sample-accurate show clock {#show-clock}
  by: codex
- [ ] Undo and redo command stack {#undo-stack}
  by: codex
- [ ] Project file save and load {#project-io}
  by: opencode
- [ ] Crash-safe autosave {#autosave}
  by: codex

## Cue editor UI {#cue-editor}
needs: [core-engine]
files: [ui/**]

- [ ] Cue list with drag reorder {#cue-list}
  by: agy
- [ ] Timeline scrubber and zoom {#timeline-scrub}
  by: agy
- [ ] Inspector panel for cue parameters {#inspector}
  by: claude
- [ ] Keyboard shortcut map {#shortcuts}
  by: opencode
- [ ] Dark stage-friendly theme {#stage-theme}
  by: agy

## Hardware bridges (DMX/OSC) {#hw-bridges}
needs: [core-engine]
files: [src/bridges/**]

- [ ] DMX universe output over Art-Net {#dmx-out}
  by: codex
- [ ] OSC send and receive endpoints {#osc-io}
  by: opencode
- [!] Device discovery on the local network {#device-discovery}
  by: claude
- [ ] Latency probe under 5 ms {#latency-probe}
  by: codex

## QA and release {#qa-release}
needs: [cue-editor, hw-bridges]
files: [tests/**, build/**, scripts/**]

- [ ] End-to-end rehearsal test {#e2e-rehearsal}
  by: claude
- [ ] Eight hour soak test {#soak-test}
  by: opencode
- [ ] Signed installers for macOS and Windows {#installers}
  by: codex
- [ ] Tag and publish v1.0 {#release-tag}
  by: claude

## Docs {#docs}
needs: [cue-editor]
files: [docs/**]

- [ ] Quick start guide {#quickstart}
  by: opencode
- [ ] Cue and OSC reference {#reference-docs}
  by: claude
- [ ] Release notes {#release-notes}
  by: agy
