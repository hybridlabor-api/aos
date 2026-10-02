---
name: doctor
description: "Check the machine and the current project, and print suggested permissions.allow entries without writing any settings. Generated from plugin-commands.json; invoke as $bdb-aos:doctor."
---

Run `aos-doctor` (machine check) and report the result. If the current folder is an AOS project, also run the project check `node <aos-project-init skill dir>/scripts/aos-project-doctor.mjs` (it covers `.aos/project.json`, AGENTS.md and the wiki). Print suggested `permissions.allow` entries as text for the human to copy. Never write to settings.json or settings.local.json. Arguments: whatever the user wrote after the skill name
