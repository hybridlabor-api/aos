---
name: playbooks
description: "List all pb-* playbooks with duration, difficulty and requirements, and start one. Generated from plugin-commands.json; invoke as $bdb-aos:playbooks."
---

Run `node <bdb-aos skill dir>/scripts/list-playbooks.mjs` and show its output (name, est_time, difficulty, requires of every `pb-*` skill). If the human names a playbook in the arguments or picks one, start that `pb-*` skill; start nothing otherwise. Each playbook keeps its own go-gate points. Arguments: whatever the user wrote after the skill name
