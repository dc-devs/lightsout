# Decision log — traverse system

**Scope:** `skills/traverse/`, `skills/build-map/`, `skills/map-connection/`,
`agents/traverse-hop.md`, `agents/scan-edges.md`,
`skills/traverse/references/connections/` (schema + map).

Settled decisions with rationale — the "do not relitigate" record. Current
behavior is described by the skill/agent files themselves; this file records
WHY, and what was rejected. Supersede with a new entry, don't edit history.
Everything here is scoped to the traverse system only — see
`docs/decisions.md` for what is (and mostly is not yet) plugin-wide.

---

## T1 — Connection docs are routers, not documentation (2026-07-03)

**Context:** Cross-repo maps rot when they carry real documentation; stale
docs mislead agents worse than no docs.

**Decision:** A connection doc is frontmatter + a 2–4 line summary. Real
documentation stays in the repos and is pointed to by `additional-context`,
injected only when a traversal actually crosses the edge.

**Rejected:** Rich edge documentation in the map — maximizes the rot surface
and duplicates what the repos already document.

## T2 — Machine-checkable anchors are the freshness mechanism (2026-07-03)

**Context:** The doc summary won't go stale, but the connection itself will
(endpoint renamed, edge removed) — and humans won't notice.

**Decision:** Every edge carries `from-anchor`/`to-anchor` (repo-root-relative
path + greppable pattern) plus `last-verified-sha`. Freshness = mechanically
re-checking anchors against code. Anchor fields exist in the schema from day
one, populated lazily if needed.

**Rejected:** Relying on humans noticing drift; anchors added "later"
(retrofitting hundreds of docs never happens).

## T3 — Central-first ownership; freshness by automation, not adoption (2026-07-03)

**Context:** The map spans many teams' repos. Wanting the full map now, without
10 teams adopting a standard first.

**Decision:** The map lives in one canonical place, built and maintained
centrally. Freshness comes from automated verification (T8) — team PRs are a
welcome accelerant, never load-bearing. The aggregation layer leaves room to
flip a repo to colocated self-owned edge docs later without consumers
noticing.

**Rejected:** Colocated per-repo edge docs as a prerequisite — teams that
won't adopt a standard in their own repo won't PR a central one either;
adoption-dependent freshness is no freshness.

## T4 — A node is a traversal unit: whole repo OR monorepo package (2026-07-03)

**Context:** Monorepos hold multiple services; the map should show
package-level nodes.

**Decision:** `from`/`to` name nodes. `repos.yaml` registers a node as a
clone URL or `{ repo, path }`; packages sharing a repo share one clone, get
their own scan scope, own inventory, and per-path staleness
(`scanned_path_sha`). The repo is a storage detail. Anchors are always
repo-root-relative.

**Rejected:** Node = repo — repo splits/merges would rewrite the map, and
monorepo services would collapse into one unusable blob node.

## T5 — An edge is a process-boundary crossing (2026-07-03)

**Context:** Monorepo packages can also communicate by direct import, which
traditional repos can't.

**Decision:** Edges are runtime process crossings: HTTP, queues/streams,
postMessage, script injection, S3 drops — including wire calls between two
packages in one repo. Direct imports are never edges: reading code crosses
that boundary fine, and the map exists for boundaries reading can't cross.
Escape hatch: an in-process bus that's opaque to reading may be mapped
deliberately as `kind: other`.

**Rejected:** Import edges — would drown the map in edges traversal never
needs.

## T6 — Responses are edges (2026-07-03)

**Context:** The config-bootstrap request's *response* carries the data of
interest; direction of data ≠ direction of request.

**Decision:** `type: response` is a first-class edge kind; `from`/`to` follow
the DATA. Scanners and hop agents treat response payloads carrying meaningful
data as exits (a bare ack is not).

**Rejected:** Request-only edges — bug traces through bootstrapped config
would silently dead-end.

## T7 — Traversal is a worklist loop; the hop agent never recurses (2026-07-03)

**Context:** "Recurse until the question is answered" spirals: the graph has
cycles (data flows both ways), budgets are unenforceable, and one context
drowns in source by hop three.

**Decision:** The orchestrator runs frontier + visited-set + hop budget,
rewriting `trace.yaml` after every hop (resumable, auditable). Each hop is
one `traverse-hop` agent: one repo, one entry anchor, structured report,
hard-forbidden from following exits. Unmapped exits are GAPs — boundaries,
not license to guess.

**Rejected:** Literal recursion in one context; hop agents that continue into
the next repo (unbounded context, unenforceable budget, cycle-unsafe).

## T8 — Map building is per-node scan + mechanical join (2026-07-03)

**Context:** Every real edge is sighted twice — outbound in the sender,
inbound in the receiver. Something must pair the sightings.

**Decision:** `scan-edges` agents inventory one node each (parallel,
inventories saved durably per node); the orchestrator joins pooled
inventories on normalized `(match_key, kind)` — deterministic string work,
not agent judgment. Joined edges are born with both anchors code-verified.
Unmatched outbounds go to a per-orphan resolver (org code search) as an
optional second wave. Rerunning the join against existing docs doubles as
the verification sweep.

**Rejected:** Agents that scan "both sides" and define connections directly —
chicken-and-egg (identifying the receiver IS the routing problem the map
exists to solve), N× duplicate scans of shared receivers, and N agents making
inconsistent matching judgments.

## T9 — Verification is change-driven and clone-free (2026-07-03)

**Context:** The org has ~1000 repos; nightly full clones don't scale and
aren't needed.

**Decision:** Verification cost is O(edges in the map), not O(repos in the
org). Anchors are checked by file fetch/API + grep — no clone. Staleness is
gated on SHA movement (`ls-remote` for repos, path-scoped last-commit for
monorepo packages) before any re-check. Traversal lazily re-verifies anchors
it passes (drift reporting rides along free). Agents run only on actual
drift.

**Rejected:** Scheduled refresh-all-clones sweeps — the lazy version of the
same guarantee at orders of magnitude more cost.

## T10 — Output modes are renderers over one trace artifact (2026-07-03)

**Context:** Four use cases (bug trace, e2e doc, diagram, feature plan) could
each have been a skill.

**Decision:** All four render from the same `trace.yaml`; `mode` selects the
renderer. Diagrams derive their Mermaid skeleton mechanically from the trace
and connection frontmatter — the agent only annotates; it never invents nodes
or edges.

**Rejected:** A skill per use case — four traversal implementations to keep
consistent. A renderer graduates to its own skill only when it accrues real
logic of its own.

## T11 — v0 orchestration lives in skills; mechanical work in agents — PROVISIONAL (2026-07-03)

**Context:** The traverse system was prototyped as pure markdown: skills as
orchestrators (loop, state, budgets, gates), agents as mechanical per-unit
workers (one hop / one node scan), spawned in parallel when independent.

**Decision:** Acceptable for the prototype, and the skill/agent SPLIT itself
is settled (rejected: wrapping a mechanical skill in an agent — a load step
with no gain). But the orchestrator being a *skill* is provisional: it
conflicts with the broader direction of moving orchestration into
deterministic code, and prompt discipline enforces none of the loop's
guarantees. Upgrade path, by blast radius: (1) schema-validate every agent's
YAML output at the boundary, (2) the join becomes a script, (3) INDEX
regeneration and anchor checks become scripts, (4) eventually a code spine
owns the loop and skills are reduced to ignition. Steps that need no
judgment (join, index regen, SHA checks, validation) should not stay
model-run longer than necessary — a corrupted map outlives any one run.

## T12 — Agents return structured YAML, parsed by the orchestrator (2026-07-03)

**Context:** The orchestrator ingests many agent results; free-text reports
drift and can't be validated.

**Decision:** Every agent's final message is ONLY a YAML document matching
the schema in its definition — data, not prose. Shared vocabularies (the
edge `kind` enum) are defined once and reused across hop reports,
inventories, and connection docs. This is also what makes T11's upgrade path
cheap: contracts already exist; code validation just enforces them.

**Rejected:** Free-text reports summarized by the orchestrator — lossy and
inconsistent across parallel agents.

## T13 — Loop state on disk; durable artifacts outside the plugin (2026-07-03)

**Context:** Runs get interrupted, hit budgets, and need auditing; later
runs should reuse earlier work.

**Decision:** Orchestrators rewrite state after every unit of work
(`trace.yaml`, `join.yaml`); durable cross-run artifacts live outside the
plugin (`~/.traverse/repos/`, `.traverse/inventories/`). Resume = re-read
state, continue the loop.

**Rejected:** Loop state only in conversation context — not resumable, not
auditable, dies with the session.

## T14 — Review gate before bulk writes (2026-07-03)

**Context:** Scanning repos surfaces hundreds of candidate edges, some noise
(health checks, metrics, SaaS calls).

**Decision:** `/build-map` presents the classified join for human culling
before authoring any doc. Scanners flag suspected noise; they never omit it
silently.

**Rejected:** Auto-writing everything and cleaning up after review — cleanup
never fully happens, and clutter poisons the next join.

---

# Migration supersessions (2026-07-05 — prototype folded into the lightsout engine)

The prototype at .notes/traverse-plugin was migrated into the engine
(BACKLOG Task 15, Phases 1–3). T1–T10 above carried over unchanged. Per the
log's own rules, changes are recorded as supersessions, never edits:

## T11 — SUPERSEDED: orchestration moved into the engine (2026-07-05)

Exactly as T11's own upgrade path predicted: the worklist loop, budget,
visited set, and trace state are engine code (`runTraverse`); the join is
code (`joinInventories`); INDEX regeneration and anchor checks are code
(`regenerateConnectionIndex`, `verifyConnectionAnchors`); skills are
reduced to ignition (`/traverse`, `/build-map` — zero logic). The
skill/agent SPLIT survives: hop and scan agents remain bounded mechanical
workers.

## T12 — SUPERSEDED in format only: agent reports are JSON (2026-07-05)

Substance kept (structured data, one shared edge-kind vocabulary, validated
at the boundary); format changed from YAML to JSON so reports ride the
engine's existing contract machinery (zod validation, cheap re-emit retry,
rejected-output evidence). Connection docs and repos.yaml stay
human-authored YAML — the change covers agent FINAL MESSAGES only.

## T13 — path amendment (2026-07-05)

Run state and inventories live under `.lightsout/traverse/` (one state root
per consumer repo); shared clones under `~/.lightsout/traverse-repos/`. The
durability guarantees are unchanged.

## map-connection draft — conservative divergence (2026-07-05)

The prototype's draft mode located the receiving repo itself. The engine's
`map-connection draft` deliberately stops earlier: it scaffolds the
code-verified from-side into `drafts/` and leaves receiver identification
to a human (or a future resolver agent) — never a guess. Drafts are
invisible to traversal until moved up. Missing anchors are reported by
`verify` rather than stamped `status: possibly-dead`; the never-delete
guarantee is identical.
