---
summary: "a folder named for the kind of code it holds (`helpers/`, `utils/` outside `common/`) instead of the domain it serves"
checked: true
severity: advisory
---

**Some folder names are junk drawers.** A folder called `helpers/`, `lib/`,
`core/`, `misc/` or `shared/` says nothing about what lives inside it — it is
where code lands when nobody decided where it belongs, and every agent that
follows dumps the next orphan there too. These five are banned at every level,
`common/` included.

**Kind-buckets have one sanctioned home.** `utils/`, `types/` and `constants/`
are the mandated skeleton *inside* `common/`; the same names anywhere else mean
files sorted by what they are instead of what they are for. Banned outside
`common/`.

**Framework vocabulary is not banned.** `components/`, `hooks/`, `services/`,
`controllers/` and `models/` are how React and NestJS projects are actually
organised — they name real framework roles, not junk drawers, and they are
legal everywhere without declaring a framework. The only privileged folder
name at any level is `common/`.

The remedy: name the folder for the domain it serves (`billing/`,
`formatting/`), or fold its files into the module that owns them.
