# Traverse — cross-repo data-flow traversal: how to use it

Traverse answers questions no single repo can answer — "why is this field
null three services downstream?", "how does an /event actually reach the
warehouse?" — by following data across process boundaries through a
committed **map** of connection docs. Agents do the reading; the engine
owns the loop, the budget, and the state. Design rationale and settled
decisions: [traverse-decisions.md](traverse-decisions.md).

## Concepts (60 seconds)

- **Node** — a traversal unit: a whole repo, or one package inside a
  monorepo. Registered in `repos.yaml`. Non-repo systems (Kinesis, external
  SaaS) are valid nodes too — traversal crosses them mechanically.
- **Edge** — a *process-boundary* crossing: HTTP, queue/stream, postMessage,
  S3 drop, script injection — and responses that carry meaningful data. A
  direct import is never an edge (reading code crosses that boundary fine;
  the map exists for boundaries reading can't cross).
- **Connection doc** — one small markdown file per edge: frontmatter + a
  2–4 line summary. Deliberately a router, not documentation — real docs
  stay in the repos, referenced via `additional-context`.
- **Anchors** — each side carries `path` + greppable `pattern` +
  `last-verified-sha`, so freshness is a machine check, not human vigilance.

## Where the map lives

Default: `.lightsout/connections/` in the repo you run from (override
anywhere with `--connections <dir>`). **The map is meant to be committed** —
it's shared team knowledge, like the scan baseline. If your `.gitignore`
ignores all of `.lightsout/` (the recommended setup for run state), carve
the map out:

```gitignore
.lightsout/
!.lightsout/connections/
!.lightsout/connections/**
```

…or keep the map in a committed directory of its own (even a dedicated map
repo) and pass `--connections`.

## 1. Register your nodes

`.lightsout/connections/repos.yaml` — node name → where its code lives:

```yaml
# whole repo
firewall-js: git@github.com:your-org/firewall-js.git
# monorepo package: packages sharing a repo share one clone
backend-api: { repo: git@github.com:your-org/platform.git, path: packages/backend-api }
```

Clones land in `~/.lightsout/traverse-repos/` (shallow, shared across runs,
refreshed when stale).

## 2. Build the map

```sh
lightsout build-map firewall-js backend-api     # or: build-map all
```

One scan agent per node runs in parallel and inventories every place data
enters or leaves that process. Inventories are saved durably
(`.lightsout/traverse/inventories/`) and are SHA-gated — re-running skips
nodes whose repos haven't moved; `--rescan` forces.

Then the engine **joins** the pooled inventories: every real edge is
sighted twice (outbound in the sender, inbound in the receiver), so a
joined edge is born with both anchors verified from code. The output is
classified — new / confirmed / drifted / orphans / noise — and stops at the
**review gate**:

```
REVIEW GATE — no docs written yet. Cull .lightsout/traverse/map-runs/<id>/join.json
```

Open `join.json`, delete anything wrong (scrutinize entries marked
`"fuzzy": true` — they matched only under tolerant normalization), then:

```sh
lightsout build-map --author <run-id>
```

That writes the connection docs, applies confirmed/drift updates, and
regenerates `INDEX.md`. Orphans usually mean the other side is a node you
haven't scanned yet — the natural input to your next `build-map`.

## 3. Traverse

```sh
lightsout traverse "why is bid_price null in QLOGS for mobile traffic?" --start firewall-js
lightsout traverse "how does /event reach the warehouse?" --start firewall-js--postbid-edge--event --mode diagram
```

- `--start` — an edge id, or a node name (seeds all its outbound edges).
- `--mode` — `answer` (default) and `bug` print the evidence chain;
  `diagram` / `doc` / `plan` also render a markdown artifact into the run
  dir (Mermaid diagram, end-to-end doc, per-repo change surface).
- `--budget <n>` — hop cap (default 12). An exhausted or rate-limited run
  parks; `lightsout traverse --run <id>` resumes from the saved frontier.
- `--data "<field>"` — narrow what the hop agents follow when the question
  is broader than the payload of interest.

Each hop is one bounded agent: one repo, one entry anchor, a structured
report — it cannot recurse into other repos. Exits are routed against the
map deterministically; an exit with **no matching doc is a GAP**, reported
as where the trail ends — never guessed through.

## 4. Grow and maintain the map

- **Gaps → drafts.** After a traversal reports gaps:
  `lightsout map-connection draft --run <traverse-run-id>` scaffolds each
  one into `connections/drafts/` with the code-verified from-side filled
  in. You (or an agent you point at it) identify the receiver, complete the
  to-side, and move the file up a level — drafts never route traversals.
- **Freshness sweep.** `lightsout map-connection verify --repair` checks
  every anchor: repos whose HEAD hasn't moved cost one `ls-remote` and
  nothing else; drifted anchors are repointed to where the pattern actually
  is; missing anchors are reported for a human (never auto-deleted). Cheap
  enough to run on a schedule.
- Traversal also reports drift on every edge it crosses — maintenance rides
  along free.

## Connection doc format (for hand-authoring)

`build-map --author` writes these for you; hand-author only for edges the
scanners can't see. Filename: `<from>--<to>--<label>.md`.

```markdown
---
from: firewall-js            # node the DATA leaves (responses: data direction, not request direction)
to: postbid-edge             # node the data enters
type: http                   # http | message-bus | postMessage | response | script-inject | s3-drop | db | other
from-anchor:                 # emit site — machine-checkable
  path: src/transport/send.ts
  pattern: "/event"
to-anchor:                   # handler — omit for non-repo nodes
  path: src/routes/event.ts
  pattern: "router.post('/event'"
schema:                      # optional: payload shape on each side
  from: src/types/EventPayload.ts
  to: src/contracts/event.ts
last-verified-sha:           # maintained by verify/--author; null until first verification
  firewall-js: null
  postbid-edge: null
additional-context:          # repo:path docs injected when a traversal crosses this edge
  - firewall-js:/docs/transport.md
---

# Summary

2–4 lines: what this edge carries and why it exists. No more — anything
longer belongs in the repos' own docs, referenced above.
```

Anchor paths are always **repo-root-relative**, whichever form the node
takes. `INDEX.md` is regenerated by the engine — don't edit it by hand.

## State on disk

| Path | What | Commit? |
|---|---|---|
| `<connections dir>/` | the map: docs, repos.yaml, INDEX.md, drafts/ | **yes** |
| `.lightsout/traverse/<run-id>/` | trace.json, per-hop agent streams, rendered modes | no (run evidence) |
| `.lightsout/traverse/map-runs/<run-id>/` | join.json (the review artifact) | no |
| `.lightsout/traverse/inventories/` | durable per-node scan inventories | optional (speeds teammates' re-joins) |
| `~/.lightsout/traverse-repos/` | shared shallow clones | never (machine-local) |
