import { z } from 'zod';
import { ConfigAutoPlan } from '#src/contracts/ConfigAutoPlan.ts';
import { ConfigCommands } from '#src/contracts/ConfigCommands.ts';
import { ConfigDocs } from '#src/contracts/ConfigDocs.ts';
import { ConfigGates } from '#src/contracts/ConfigGates.ts';
import { ConfigQueue } from '#src/contracts/ConfigQueue.ts';
import { ConfigShip } from '#src/contracts/ConfigShip.ts';
import { ConfigTicketTracker } from '#src/contracts/ConfigTicketTracker.ts';
import { renamedKey } from '#src/contracts/common/utils/renamedKey.ts';
import { Effort } from '#src/contracts/Effort.ts';
import { PackageGates } from '#src/contracts/PackageGates.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import { StandardsCheckOverrides } from '#src/contracts/StandardsCheckOverrides.ts';

/**
 * Consumer configuration (`lightsout.config.json` at the target repo root).
 * This is the only coupling point between the engine and a consumer, and every
 * block naming an outside service is opt-in — so the engine runs with no
 * tracker, no forge convention and no documentation surfaces at all.
 *
 * Every key is kebab-case, the spelling of the file rather than of the code
 * that reads it: `package-gates`, `test-coverage`, `agent-commands`. The parsed
 * value keeps that spelling, so a run manifest's config snapshot round-trips
 * through this schema unchanged and a reader of either file sees one
 * vocabulary. Each key's previous camelCase spelling is declared beside it as
 * a refusal that names the new one.
 *
 * Composed from the block contracts beside it — `ConfigGates`, `PackageGates`,
 * `ConfigCommands`, `StandardsCheckOverrides` — each of which pins its own
 * shape in its own test.
 */
export const LightsoutConfig = z.object({
	/** Harness name. Defaults to 'claude-code'. */
	harness: z.string().optional(),
	/** Model override passed through to the harness. */
	model: z.string().optional(),
	/** Reasoning effort passed through to the harness. Omit to take each harness's own default. */
	effort: z.enum(Effort).optional(),
	/**
	 * Harness-neutral capability level for agent invocations. Defaults to
	 * 'write'. `read-only` is engine-selected for the supervisor and is
	 * deliberately not settable — it would make a writing role write nothing.
	 */
	permissions: z.enum([Permissions.Write, Permissions.FullAccess]).optional(),
	/** Removed — renamed to `harness`. Declared only so a stale key fails loudly instead of being silently stripped. */
	driver: renamedKey({ from: 'driver', to: 'harness' }),
	/** Removed — replaced by `permissions`. Same reason. */
	permissionMode: z.never('`permissionMode` was replaced by `permissions` (`write` or `full-access`)').optional(),
	/** Removed — renamed to `gates`. Same reason. */
	scripts: renamedKey({ from: 'scripts', to: 'gates' }),
	/** Removed — renamed twice over; the current name is `package-gates`. Same reason. */
	packageScripts: renamedKey({ from: 'packageScripts', to: 'package-gates' }),
	/** Per-command harness selection. See `ConfigCommands`. */
	commands: ConfigCommands.optional(),
	/** Verification commands — the mechanical gates. See `ConfigGates`. */
	gates: ConfigGates,
	/**
	 * Agent invocation ceilings, in minutes. A hit ceiling is a recorded step
	 * failure the run can resume from — never a crash.
	 */
	timeouts: z
		.object({
			/** Working roles (executor, test writers, refactorer, fixes). Default 60. */
			'agent-minutes': z.number().positive().optional(),
			/** The read-only supervisor. Default 15. */
			'supervisor-minutes': z.number().positive().optional(),
			/** Removed — renamed to `agent-minutes`. Declared only so a stale key fails loudly instead of being silently stripped. */
			agentMinutes: renamedKey({ from: 'timeouts.agentMinutes', to: 'timeouts.agent-minutes' }),
			/** Removed — renamed to `supervisor-minutes`. Same reason. */
			supervisorMinutes: renamedKey({ from: 'timeouts.supervisorMinutes', to: 'timeouts.supervisor-minutes' }),
		})
		.optional(),
	/**
	 * Command prefixes working agents are granted (prefix match, arguments
	 * allowed) — for plan deliverables only a command can produce, e.g. a
	 * migration generator that needs the live dev database. Injected into the
	 * executor's task as an explicit grant list and passed to the harness as
	 * allowed tools. Verification commands never belong here: the engine runs
	 * all gates itself, and agents are told grants are not for verifying.
	 */
	'agent-commands': z.array(z.string()).optional(),
	/** Removed — renamed to `agent-commands`. Declared only so a stale key fails loudly instead of being silently stripped. */
	agentCommands: renamedKey({ from: 'agentCommands', to: 'agent-commands' }),
	/**
	 * Path prefixes of generated/derived files (e.g. a Prisma client output
	 * dir). Treated like gate artifacts: real files in the diff, but excluded
	 * from changed-file attribution — they never earn agent turns and never
	 * pollute the manifest. The source that generates them is the change.
	 *
	 * This is also where a repo says its build output lands when the walk
	 * cannot guess it. `listSourceFiles` skips `dist`, `build`, `coverage` and
	 * `out` by name outside a `src` folder; anything else — an output dir with
	 * a house name, or one written inside `src` — is invisible to the engine
	 * until it is named here, and would otherwise be checked as source.
	 */
	generated: z.array(z.string()).optional(),
	/**
	 * Path prefixes of third-party code the repo vendors in rather than writes
	 * (e.g. a shadcn/ui component folder a generator drops in and the app then
	 * edits). Excluded from the source walk exactly as `generated` is, so its
	 * conventions are never judged against this repo's standards, it never
	 * becomes a test subject, and it never shows up as prior art.
	 *
	 * It differs from `generated` in the one way that matters: a vendored file
	 * IS attributed when it changes. Generated output is excluded from
	 * attribution because the source that produced it is the real change;
	 * vendored code has no such source in the repo, so an edit inside it is the
	 * change and must earn its agent turn like any other.
	 *
	 * The engine's exclusion stops the engine's own checks and nothing else. A
	 * repo whose coverage threshold covers the vendored path must exclude it
	 * there too — that gate is the repo's test runner, which the engine only
	 * invokes.
	 */
	vendored: z.array(z.string()).optional(),
	/**
	 * Path to the JSON coverage summary the coverage tooling writes (default
	 * `coverage/coverage-summary.json`) — repo-relative in single-package
	 * repos, package-relative in monorepo mode. `lightsout
	 * test-coverage-to-threshold` reads per-file percentages from it; the file
	 * is the tool-agnostic contract, so a printed coverage table changing
	 * format never breaks the run.
	 */
	'coverage-summary-path': z.string().optional(),
	/** Removed — renamed to `coverage-summary-path`. Declared only so a stale key fails loudly instead of being silently stripped. */
	coverageSummaryPath: renamedKey({ from: 'coverageSummaryPath', to: 'coverage-summary-path' }),
	/**
	 * How many source files one plan or phase may create or modify before the
	 * feature executor refuses it. Default 50 (`defaultExecutorFileLimit`).
	 *
	 * It is one key rather than a number per reader because the plan lint's
	 * advisory size warning, the phased-versus-single scope estimate, the plan
	 * template and the executor's own stop rule must agree by construction: a
	 * plan graded against a softer number and then refused at implement time
	 * costs a whole run to learn what the lint already knew.
	 */
	'executor-file-limit': z.number().positive().optional(),
	/** Directory holding workspace packages, for monorepo scoped gates. Default 'packages'. */
	'packages-dir': z.string().optional(),
	/** Removed — renamed to `packages-dir`. Same reason. */
	packagesDir: renamedKey({ from: 'packagesDir', to: 'packages-dir' }),
	/** Monorepo scoped gate templates. See `PackageGates`. */
	'package-gates': PackageGates.optional(),
	/** Removed — renamed to `package-gates`. Same reason. */
	packageGates: renamedKey({ from: 'packageGates', to: 'package-gates' }),
	/**
	 * Standards packs a run works against. Unspecified = the pack the plugin
	 * ships (announced in the run header); `false` = explicitly none; an array =
	 * exactly these, where each entry is the root folder of a standards pack —
	 * the folder holding `lightsout-standards.json` — repo-relative or absolute.
	 * One key, not two: a pack carries both the code and the test document
	 * trees, so a second key could only disagree with this one about which pack
	 * is loaded. A root that cannot be loaded is a hard error.
	 */
	'standards-packs': z.union([z.array(z.string()), z.literal(false)]).optional(),
	/** Removed — renamed to `standards-packs`. Declared only so a stale key fails loudly instead of being silently stripped. */
	'standards-packages': renamedKey({ from: 'standards-packages', to: 'standards-packs' }),
	/** Removed — renamed to `standards-packs`. Same reason. */
	standardsPackages: renamedKey({ from: 'standardsPackages', to: 'standards-packs' }),
	/** Removed — replaced by `standards-packs`. Same reason. */
	standards: z.never('`standards` was replaced by `standards-packs` — standards now load as packs').optional(),
	/** Removed — the test tree ships inside a standards pack. Same reason. */
	testStandards: z.never('`testStandards` was replaced by `standards-packs` — standards now load as packs').optional(),
	/**
	 * Framework channels of the loaded standards packs (e.g. 'react',
	 * 'tanstack'). Unspecified = detected per run from the scoped packages'
	 * package.json dependencies; an array REPLACES detection (empty = base
	 * docs only).
	 */
	'standards-channels': z.array(z.string()).optional(),
	/** Removed — renamed to `standards-channels`. Declared only so a stale key fails loudly instead of being silently stripped. */
	standardsChannels: renamedKey({ from: 'standardsChannels', to: 'standards-channels' }),
	/** Removed — renamed twice over; the current name is `standards-checks`. Same reason. */
	scan: renamedKey({ from: 'scan', to: 'standards-checks' }),
	/** Per-rule severity/settings overrides. See `StandardsCheckOverrides`. */
	'standards-checks': StandardsCheckOverrides.optional(),
	/** Removed — renamed to `standards-checks`. Same reason. */
	standardsChecks: renamedKey({ from: 'standardsChecks', to: 'standards-checks' }),
	/** Opt-in ship settings — branch ticket pattern, pull request body template, merge method. See `ConfigShip`. */
	ship: ConfigShip.optional(),
	/** Opt-in auto-plan settings — which of `/auto-plan`'s checkpoints this repo keeps. See `ConfigAutoPlan`. */
	'auto-plan': ConfigAutoPlan.optional(),
	/** Opt-in tracker identity — provider, team, and the API-key environment variable. See `ConfigTicketTracker`. */
	'ticket-tracker': ConfigTicketTracker.optional(),
	/** Opt-in queue settings — route labels, parallelism, eligible statuses and the queue's own timeouts. See `ConfigQueue`. */
	queue: ConfigQueue.optional(),
	/** Opt-in documentation surfaces — each a repo-relative path and what that document covers. See `ConfigDocs`. */
	docs: ConfigDocs.optional(),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
