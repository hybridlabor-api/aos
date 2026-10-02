---
name: shipping
description: "Pre-ship framing and the technical release gate, with approvals under the go-gate rules. Generated from plugin-commands.json; invoke as $bdb-aos:shipping."
---

Use `bdb-shipping-skill` for the pre-flight and `godmode-shipping` for the gate. The playbook `pb-ship` can drive the whole flow. Push, merge and publish need the human's GO under the go-gate rules; never request one on the human's behalf. Arguments: whatever the user wrote after the skill name
