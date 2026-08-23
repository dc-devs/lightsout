---
summary: "a folder named for the role of the code it holds"
checked: true
severity: advisory
---

**Banned module names — a closed list, not a judgment call.** A folder is never named for the *role* of the code it holds: `helpers/`, `utils/`\*, `lib/`, `core/`, `misc/`, `shared/`, `services/`\*, `controllers/`, `models/`, `hooks/`, `components/`, `types/`\*, `constants/`\* (\* legal inside `common/` per its closed list). Where the package's framework doc mandates one of these names (NestJS layout, React feature `components/`, file-based routers), the framework doc wins — the same carve-out as folder casing below. The only privileged folder name at any level is `common/`.
