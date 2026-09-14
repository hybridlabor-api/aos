# Fleet Hub Overview/Login Page — Copy & Brand-Color Fix Plan

Target file: `/Users/timrennings/dev/bdb-fleet-hub/public/login.html` (live at
`https://hub.awsbdb.rcentry.pro/overview/`). This is a Zero-Trust SSO
identity-provider selector, not a marketing page — copy stays crisp and
technical, aimed at engineers/operators who already know what they're
choosing between. No functional element changes: both provider names, both
real hostnames, and the footer status link are preserved exactly.

A raw backup already exists at
`docs/backups/hub-overview-20260915.html` (confirmed byte-identical to the
live file's content as read for this plan) — do not modify or delete it.

---

## 1. Finished English copy, per element

| Element | Current | Finished copy | Change |
|---|---|---|---|
| Badge text (`.badge span`, line 168) | `BDB Zero-Trust Perimeter` | `BDB Zero-Trust Perimeter` | **No change.** Already precise, correct security terminology (a Zero-Trust "perimeter" is the standard term for the enforced trust boundary) — rewriting it would trade accuracy for novelty. |
| H1 (line 171) | `Select Identity Realm` | `Choose Your Identity Provider` | "Realm" is Keycloak-internal jargon that doesn't match the SSO vocabulary the page itself uses one line down ("identity provider"). Standardizing on "identity provider" removes the inconsistency and matches how operators actually talk about this choice. |
| Description (`p.desc`, lines 172–174) | `The Fleet Operations Hub is protected by central single-sign-on. Choose your assigned identity provider to continue:` | `This portal is protected by centralized single sign-on. Select the identity provider assigned to your account to continue.` | Tightens the sentence, fixes "central single-sign-on" → "centralized single sign-on" (the correct term), and removes the verb collision with the new H1 (both previously said "Choose"). |
| Button 1 title (line 179) | `BDB Dev Intern (AWS)` | `BDB Dev Intern (AWS)` | **No change.** This is an operator-facing environment identifier, not marketing copy — altering its wording risks an operator not recognizing the option they're looking for. |
| Button 1 subtitle (line 180) | `auth.awsbdb.rcentry.pro` | `auth.awsbdb.rcentry.pro` | **No change** — real hostname, must stay exact. |
| Button 2 title (line 187) | `rcentry.cloud (GCP / Netcup)` | `rcentry.cloud (GCP / Netcup)` | **No change**, same reasoning as Button 1. |
| Button 2 subtitle (line 188) | `auth.rcentry.pro` | `auth.rcentry.pro` | **No change** — real hostname. |
| Footer left (line 195) | `Step-CA SSH & TLS Enabled` | `Step-CA — SSH & TLS Active` | Same meaning (Step-CA issues/enforces both cert classes), reads as a status line rather than a checkbox label — consistent with the footer's role as a live-status strip. |
| Footer right link (line 196) | `Status NOC →` | `Status NOC →` | **No change** — internal system name (Network Operations Center dashboard), and the `href` is untouched. |

### Exact HTML edits (copy only)

```html
<!-- line 171 -->
<h1>Choose Your Identity Provider</h1>

<!-- lines 172-174 -->
<p class="desc">
  This portal is protected by centralized single sign-on. Select the identity provider assigned to your account to continue.
</p>

<!-- line 195 -->
<span>Step-CA — SSH &amp; TLS Active</span>
```

Note the footer line already used a literal `&` (`Step-CA SSH & TLS Enabled`)
without HTML-escaping it — the existing file is not consistent about this
elsewhere either, so `&amp;` above is optional polish, not a required fix;
apply it only if the execution agent is doing a full pass, otherwise a literal
`&` is fine and matches current file convention.

Everything else in the file (structure, both `<a href>` targets, the favicon
links, fonts, script-free static markup) stays untouched.

---

## 2. Brand-violation fix: cyan/sky-blue → BDB Accent Lila

**Violation:** the page uses `#38bdf8` (sky-blue/cyan) and
`rgba(14, 165, 233, …)` (its rgb equivalent, `#0ea5e9`) in five CSS rules.
BDB brand standard is **Dominant Black (`#0a0a0a`) & White (`#FFFFFF`) with
Accent Lila (`#9b30c4`)** — no mint/cyan, anywhere. `#9b30c4` is already the
correct accent in this same file (the `.choice-aws` button already uses it
correctly) — these substitutions bring the rest of the page in line with it.

This is a color-token substitution only, not a CSS rewrite. Every occurrence
below is a plain string find → replace inside the existing `<style>` block.

| # | Find (exact string) | Replace with | Location / rule |
|---|---|---|---|
| 1 | `#38bdf8` | `#9b30c4` | `.badge { color: #38bdf8; }` (line 61) |
| 2 | `#38bdf8` | `#9b30c4` | `.pulse { background: #38bdf8; }` (line 68) |
| 3 | `#38bdf8` | `#9b30c4` | `.pulse { box-shadow: 0 0 8px #38bdf8; }` (line 69) |
| 4 | `#38bdf8` | `#9b30c4` | `.footer a:hover { color: #38bdf8; }` (line 160) |
| 5 | `rgba(14, 165, 233, 0.05)` | `rgba(155, 48, 196, 0.05)` | `body::before` background gradient, middle stop (line 35) |
| 6 | `rgba(14, 165, 233, 0.08)` | `rgba(155, 48, 196, 0.08)` | `.choice-gcp { background: … }` (line 111) |
| 7 | `rgba(14, 165, 233, 0.3)` | `rgba(155, 48, 196, 0.3)` | `.choice-gcp { border: 1px solid … }` (line 112) |
| 8 | `rgba(14, 165, 233, 0.18)` | `rgba(155, 48, 196, 0.18)` | `.choice-gcp:hover { background: … }` (line 115) |
| 9 | `rgba(14, 165, 233, 0.55)` | `rgba(155, 48, 196, 0.55)` | `.choice-gcp:hover { border-color: … }` (line 116) |
| 10 | `rgba(14, 165, 233, 0.25)` | `rgba(155, 48, 196, 0.25)` | `.choice-gcp:hover { box-shadow: 0 10px 25px -5px … }` (line 118) |

Rows 1–4 are the same find/replace pair applied at all 4 occurrences of that
exact hex string; rows 5–10 are six distinct rgba alpha values, each
occurring exactly once, so each is its own literal find/replace.

**Advisory (flagging only, not a rewrite):** `.choice-aws` already uses
`rgba(155, 48, 196, …)` at alphas 0.12 / 0.35 / 0.22 / 0.6 / 0.3. After this
fix, `.choice-gcp` converges on the *same hue* at *slightly different*
alphas (0.08 / 0.3 / 0.18 / 0.55 / 0.25) — both provider buttons will read as
near-identical purple, distinguished only by their label text, since BDB's
standard defines a single accent color and this task's scope is the color
substitution, not a redesign. If distinct visual identity between the two
provider buttons matters, that needs a separate design decision (e.g. one
button outlined/neutral, the other accented) — out of scope here by
instruction ("do not attempt a full CSS rewrite").

No other cyan/sky-blue values exist in the file — confirmed by reading all
200 lines; `#38bdf8` and the six `rgba(14, 165, 233, …)` instances above are
the complete set.
