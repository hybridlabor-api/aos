---
description: "Pre-ship framing and the technical release gate, with approvals under the go-gate rules."
---

Use `bdb-shipping-skill` for the pre-flight and `godmode-shipping` for the gate. The playbook `pb-ship` can drive the whole flow. Push, merge and publish need the human's GO under the go-gate rules; never request one on the human's behalf. Arguments: $ARGUMENTS
