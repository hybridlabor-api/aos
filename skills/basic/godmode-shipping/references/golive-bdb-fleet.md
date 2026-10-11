# BDB fleet (own backend) as a guided hosting provider

AOS addition, not part of upstream golive. Use when the human wants the app on the BDB fleet instead of Vercel,
Netlify or another listed host. golive has no adapter for it, so it is a **guided** provider
(`references/guided.md` applies in full): record it with `init --stack hosting=bdb-fleet,...`; `doctor` returns
`ok: false` for it by design.

## Availability

The deploy path relies on skills that are not shipped with AOS (`bdbsaashost`, `deploy-incus`), see the
`pb-deploy-saas` playbook. Without them, say so and offer a listed host instead. Do not improvise a fleet deploy.

## How the hosting step runs

1. Run the `pb-deploy-saas` playbook for the hosting step. Its inputs are the repo, the target fleet instance and the
   path: `incus-ci` (push to the Forgejo remote, the runner deploys to Incus) or `direct` (`bdb-deploy`, rsync over SSH).
2. The playbook has its own approval gate (`[GO] deploy`). golive's plan approval does not replace it, and a GO covers
   one step, one time. List the deploy as an operation outside `apply` in `docs/GOLIVE-<stage>-PLAN.md`.
3. Verification is the playbook's health check (status line and version marker). Record it in
   `docs/GOLIVE-<stage>-RESULT.md`; HTTP 200 alone does not prove the intended app is serving.
4. Database, auth, email, payments and DNS are not part of the fleet deploy: choose them from golive's other
   providers, or guide them as described in `guided.md`.

## Handover and teardown

golive's automated teardown does not know the fleet. Treat removing the instance or its routes as a separate guided,
human-approved step; name the exact instance and path first, and never delete anything on the fleet from this skill.
