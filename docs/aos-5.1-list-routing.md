# AOS 5.1 backlog — routing and daily tools

Deferred from the 5.0.0 routing work package (spec:
`aos-routing-and-daily-tools.md`, items 5 and 6).

## 1. Windows canvas persistence and a Hub service for plan-canvas (R2)

On Windows, the git harness stops background servers, so a plan-canvas server
started "just for this session" dies and review loops break between sessions.
Two-part fix for 5.1: first, persistence — the canvas server on Windows must
survive the source over a reboot or at least record its state so
`aos-plan-canvas open` can resume cleanly; second, longevity — let a Hub-level
service (or `aos services`) own the canvas server so it is not tied to any
single harness session at all. Every harness then talks to one persistent
server instead of each spawning its own by session start.

## 2. Annotation toolbar labels (R7, annotation v2)

The annotation toolbar letters V, T, R, A, F, B, C are hard to understand. In
annotation v2, every letter button needs a visible label plus a tooltip
(name, what it does), and while there, the other annotation-v2 findings roll
in: a notes list with connector lines back to the annotated element, running
dev servers (Tailwind, TSX, React, Vite, and Tim's home manager app) shown
natively in the canvas, and agent replies rendered as a proper thread instead
of a flat feed. Details live in `annotation-v2-vision.md`.
