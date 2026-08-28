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
 */
export const configKeyDescriptions: Record<string, string> = {
	harness: "Harness name. Defaults to 'claude-code'.",
	model: 'Model override passed through to the harness.',
	effort: "Reasoning effort passed through to the harness. Omit to take each harness's own default.",
	permissions:
		"Harness-neutral capability level for agent invocations. Defaults to 'write'. `read-only` is engine-selected for the supervisor and is deliberately not settable — it would make a writing role write nothing.",
	commands:
		'Per-command harness selection (`plan` covers draft, dedup and grade; `resume` always keeps the run manifest’s recorded harness). Each entry overrides the global harness, model and effort for that command; unlisted commands use the globals.',
	gates: 'Verification commands — the mechanical gates. Full shell commands, run by the engine itself; agents never run them.',
	timeouts: 'Agent invocation ceilings, in minutes. A hit ceiling is a recorded step failure the run can resume from — never a crash.',
	'timeouts.agent-minutes': 'Ceiling for the working roles — executor, test writers, refactorer, fixes.',
	'timeouts.supervisor-minutes': 'Ceiling for the read-only supervisor, which reads and rules rather than editing.',
	'agent-commands':
		'Command prefixes working agents are granted (prefix match, arguments allowed) — for plan deliverables only a command can produce, such as a migration generator. Verification commands never belong here: the engine runs all gates itself.',
	generated:
		'Path prefixes of generated or derived files. Real files in the diff, but excluded from changed-file attribution — the source that generates them is the change. Also where a repo says its build output lands when the walk cannot guess it.',
	vendored:
		'Path prefixes of third-party code the repo vendors in rather than writes. Excluded from the source walk exactly as `generated` is, with one difference: a vendored file IS attributed when it changes, because no source in the repo produced it.',
	'coverage-summary-path':
		'Path to the JSON coverage summary the coverage tooling writes — repo-relative in single-package repos, package-relative in monorepo mode. The file is the tool-agnostic contract, so a printed coverage table changing format never breaks a run.',
	'executor-file-limit':
		'How many source files one plan or phase may create or modify before the feature executor refuses it. One key rather than a number per reader, so the plan lint, the scope estimate and the executor’s own stop rule agree by construction.',
	'packages-dir': 'Directory holding workspace packages, for monorepo scoped gates.',
	'package-gates': 'Monorepo scoped gate templates — the per-package commands `{package}` is substituted into.',
	'standards-packs':
		'Standards packs a run works against. Unspecified = the pack the plugin ships; `false` = explicitly none; an array = exactly these pack roots, each the folder holding `lightsout-standards.json`. A root that cannot be loaded is a hard error.',
	'standards-channels':
		"Framework channels of the loaded standards packs (e.g. 'react', 'tanstack'). Unspecified = detected per run from the scoped packages' package.json dependencies; an array REPLACES detection, and an empty one means base documents only.",
	'standards-checks': 'Per-rule severity and settings overrides, keyed by rule id. A rule not named here keeps its pack’s default — silence is never a change.',
	ship: 'Opt-in ship settings: the branch ticket pattern whose `ticket` capture group becomes the result’s ticket reference, the pull request body template, the merge method, and whether a passed implement run chains into ship.',
};
