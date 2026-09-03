/**
 * What each live `lightsout.config.json` key is for, in the schema's own words.
 *
 * Transcribed from `LightsoutConfig`'s doc comments rather than read from them:
 * TypeScript doc comments are erased before anything runs, so a transcription is
 * the only honest route to the sentence a reader of the file would see.
 *
 * Live keys only. The removed spellings are declared in the schema purely so a
 * stale config fails loudly, and a key nobody may write needs no explanation —
 * which is exactly what the coverage test beside this file proves about every
 * key missing from here.
 *
 * The two `timeouts.` entries are the block's leaves rather than shape keys: the
 * block's two defaults are per leaf, so the page gives each its own row and each
 * row needs its own sentence.
 *
 * This is also what `docs/configuration.md`'s key reference is rendered from, so
 * a sentence edited here changes that document and `pnpm check` fails until
 * `pnpm build:config-reference` has been run.
 */
export const configKeyDescriptions: Record<string, string> = {
	harness: "Harness name. Supported values are 'claude-code' and 'codex'. Defaults to 'claude-code'.",
	model: 'Model override passed through to the selected harness.',
	effort: "Reasoning effort passed through to the harness — one of `low`, `medium`, `high`, `xhigh` or `max`. Omit to take each harness's own default.",
	permissions:
		"Harness-neutral capability level for agent invocations: `write` lets agents edit files and run commands inside the workspace, `full-access` bypasses the harness's sandbox entirely. Defaults to 'write'. `read-only` is engine-selected for the supervisor and is deliberately not settable — it would make a writing role write nothing.",
	commands:
		'Per-command harness selection for `plan`, `implement`, `refactor`, `test-coverage-to-threshold` and `improve` (`plan` covers draft, dedup and grade; `resume` always keeps the run manifest’s recorded harness). Each entry overrides the global harness, model and effort for that command; unlisted commands use the globals. A global model is not inherited by a command that selects a different harness; a global effort is, because the five levels mean the same thing everywhere. An unknown command key is rejected rather than silently ignored.',
	gates: 'Verification commands — the mechanical gates. Full shell commands, run by the engine itself; agents never run them.',
	timeouts: 'Agent invocation ceilings, in minutes. A hit ceiling is a recorded step failure the run can resume from — never a crash.',
	'timeouts.agent-minutes':
		'Ceiling for the working roles — executor, test writers, refactorer, fixes. Defaults to 60. Reaching it stops the harness together with every process it started — a terminate signal first, then a kill if that is ignored.',
	'timeouts.supervisor-minutes': 'Ceiling for the read-only supervisor, which reads and rules rather than editing. Defaults to 15.',
	'agent-commands':
		'Command prefixes working agents are granted (prefix match, arguments allowed) — for plan deliverables only a command can produce, such as a migration generator. Verification commands never belong here: the engine runs all gates itself.',
	generated:
		'Path prefixes of generated or derived files. Real files in the diff, but excluded from changed-file attribution — the source that generates them is the change. Also where a repo says its build output lands when the walk cannot guess it.',
	vendored:
		'Path prefixes of third-party code the repo vendors in rather than writes, such as a shadcn/ui component folder. Excluded from the source walk exactly as `generated` is, so the standards never judge it, no test is written for it and no refactor pass touches it — with one difference: a vendored file IS attributed when it changes, because no source in the repo produced it. Excluding it from a coverage threshold is your test runner’s job, not the engine’s.',
	'coverage-summary-path':
		'Path to the JSON coverage summary the coverage tooling writes — the `json-summary` reporter’s `coverage-summary.json`, which `lightsout test-coverage-to-threshold` reads for per-file percentages. Defaults to `coverage/coverage-summary.json`, repo-relative in single-package repos and package-relative in monorepo mode. The file is the tool-agnostic contract, so a printed coverage table changing format never breaks a run.',
	'executor-file-limit':
		'How many source files one plan or phase may create or modify before the feature executor refuses it as out of scope. Defaults to 50. One key rather than a number per reader, so the plan lint, the scope estimate and the executor’s own stop rule agree by construction. A plan that is mostly mechanical edits raises its own allowance with a `## File Budget` section rather than moving this key; the separate ceiling on files a plan creates is fixed and cannot be raised either way.',
	'packages-dir': 'Directory holding workspace packages, for monorepo scoped gates. Defaults to `packages`.',
	'package-gates':
		'Monorepo scoped gate templates — the per-package commands `{package}` is substituted into. Each template runs once per affected package, so a gate runs only for the packages a change touched.',
	'standards-packs':
		'Standards packs a run works against. Unspecified = the pack the plugin ships; `false` = explicitly none; an array = exactly these pack roots, each the folder holding `lightsout-standards.json`, repo-relative or absolute. One pack carries both the code and the test documents, which is why there is a single key rather than two. A root that cannot be loaded is a hard error.',
	'standards-channels':
		"Framework channels of the loaded standards packs (e.g. 'react', 'tanstack'). Unspecified = detected per run from the scoped packages' package.json dependencies; an array REPLACES detection, and an empty one means base documents only.",
	'standards-checks':
		'Per-rule severity and settings overrides for `lightsout standards-check`, keyed by rule id. A rule not named here keeps its pack’s default — silence is never a change.',
	ship: 'Opt-in `lightsout ship` settings: the branch ticket pattern whose `ticket` capture group becomes the result’s ticket reference, the pull request body template, the merge method, whether a passed implement run chains into ship, and an optional pre-ship command run before anything is pushed.',
	'ticket-tracker':
		'Opt-in tracker identity: which provider the engine talks to and that provider’s address and credential environment variables — a Linear team and API key, or a Jira Cloud site, project, API token and account email. Every command that reads or writes a ticket resolves it from here, so tracker identity is spelled once rather than once per command.',
	queue:
		'Opt-in queue settings: which ticket label names each planning status, what this tracker calls each status the engine writes, which statuses count as available work, how many tickets run at once, and the per-ticket worker and question timeouts. Tracker identity lives in `ticket-tracker`, so this block holds queue behaviour only.',
	'auto-plan':
		'Opt-in auto-plan settings: whether the proposal comes before drafting, whether an approved proposal starts the build, and whether the proposal is skipped when nothing clears the escalation bar. Every key is off by default, so an absent block is the most supervised behaviour.',
	docs: 'Opt-in documentation surfaces: each entry a repo-relative path and a one-line `covers` saying what that document is responsible for. Declaring the block turns on the plan-time documentation check — the plan writer is briefed on the surfaces, every implementable plan file must carry a `## Documentation` statement, and `plan grade` runs one whole-plan checker that verifies it. A repository that declares no block sees none of it: no section, no prompt text, no checker spawn.',
};
