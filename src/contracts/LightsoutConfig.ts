import { z } from 'zod';
import { Effort } from '@/contracts/Effort';
import { Permissions } from '@/contracts/Permissions';
// Through the barrel, not the file: `standardsCheck` is a module of its own
// inside contracts, and its index.ts is the path in. No cycle — nothing under
// it reads the config.
import { StandardsSeverity } from '@/contracts/standardsCheck';

/**
 * A rule's severity, with the pre-rename spelling called out by name.
 *
 * `finding` was this severity's value until it collided with the umbrella noun
 * — every hit the check reports is a finding, at any severity. A config written
 * against the older docs gets told what happened rather than a bare list of
 * valid options, the same courtesy the renamed `scan` key gets below.
 */
const standardsSeverityValue = z.enum(StandardsSeverity, {
	error: (issue) => (issue.input === 'finding' ? 'severity `finding` was renamed to `blocking`' : undefined),
});

/** One command's harness override: harness, model, and/or effort, each falling back to the global field. */
const commandHarness = z
	.object({
		/** Harness name for this command ('claude-code' or 'codex'). Falls back to the global `harness`. */
		harness: z.string().optional(),
		/** Model for this command's harness. The global `model` falls through only when this command resolves to the global harness. */
		model: z.string().optional(),
		/** Reasoning effort for this command. Falls back to the global `effort` regardless of which harness the command selects — the five levels mean the same thing everywhere. */
		effort: z.enum(Effort).optional(),
	})
	.strict();

/**
 * Consumer configuration (`lightsout.config.json` at the target repo root).
 * This is the only coupling point between the engine and a consumer — the
 * engine never knows a consumer by name.
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
	driver: z.never('`driver` was renamed to `harness`').optional(),
	/** Removed — replaced by `permissions`. Same reason. */
	permissionMode: z.never('`permissionMode` was replaced by `permissions` (`write` or `full-access`)').optional(),
	/**
	 * Per-command harness selection (`plan` covers draft/dedup/grade; `resume`
	 * always keeps the run manifest's recorded harness). Each entry overrides the
	 * global `harness`/`model`/`effort` for that command; unlisted commands use
	 * the globals. Both objects are `.strict()` — unlike the rest of the config,
	 * a typoed key here would silently disable an override the user believes
	 * is active, so it fails parsing loudly instead.
	 */
	commands: z
		.object({
			implement: commandHarness.optional(),
			refactor: commandHarness.optional(),
			improve: commandHarness.optional(),
			plan: commandHarness.optional(),
		})
		.strict()
		.optional(),
	/** Verification commands — the mechanical gates. Full shell commands. */
	scripts: z.object({
		check: z.string(),
		testUnit: z.string(),
		/**
		 * Coverage gate — on by default. Required: either a full shell command
		 * (run at clean-slate and every post-test verify) or the literal
		 * `false` to explicitly opt out. Silence is not an option: skipping
		 * the strongest gate must be a decision, not an accident.
		 */
		testCoverage: z.union([z.string(), z.literal(false)]),
		/**
		 * Opt-in codegen, run once BEFORE every gate set (not inside check:
		 * gates verify, generate mutates). Red exit fails the gate set.
		 */
		generate: z.string().optional(),
		/** Opt-in build gate, run last in every verify. Omit when nothing compiles. */
		build: z.string().optional(),
		/** Opt-in formatter, run once at the very end of the pipeline (gates re-verify after). */
		format: z.string().optional(),
	}),
	/**
	 * Agent invocation ceilings, in minutes. A hit ceiling is a recorded step
	 * failure the run can resume from — never a crash.
	 */
	timeouts: z
		.object({
			/** Working roles (executor, test writers, refactorer, fixes). Default 60. */
			agentMinutes: z.number().positive().optional(),
			/** The read-only supervisor. Default 15. */
			supervisorMinutes: z.number().positive().optional(),
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
	agentCommands: z.array(z.string()).optional(),
	/**
	 * Path prefixes of generated/derived files (e.g. a Prisma client output
	 * dir). Treated like gate artifacts: real files in the diff, but excluded
	 * from changed-file attribution — they never earn agent turns and never
	 * pollute the manifest. The source that generates them is the change.
	 */
	generated: z.array(z.string()).optional(),
	/** Directory holding workspace packages, for monorepo scoped gates. Default 'packages'. */
	packagesDir: z.string().optional(),
	/**
	 * Monorepo mode: gate command templates run per affected package, with
	 * `{package}` replaced by that package's package.json `name`. When set,
	 * verifies run scoped to the run's package scope (plan front-matter
	 * `packages:` list or `--packages`, expanded as changed files reveal the
	 * true blast radius) and `scripts.*` becomes the root-group commands, run
	 * only when files outside the packages directory change.
	 */
	packageScripts: z
		.object({
			check: z.string(),
			testUnit: z.string(),
			/** Scoped coverage gate. Omitted = no coverage gate for package groups. */
			testCoverage: z.string().optional(),
			/** Opt-in scoped build gate. */
			build: z.string().optional(),
		})
		.refine((scripts) => Object.values(scripts).every((command) => command === undefined || command.includes('{package}')), {
			message: 'every packageScripts command must contain the {package} placeholder — a command without it would run identically for every package and belongs in scripts.* instead',
		})
		.optional(),
	/**
	 * Standards packages a run works against. Unspecified = the package the
	 * plugin ships (announced in the run header); `false` = explicitly none; an
	 * array = exactly these, where each entry is the root folder of a standards
	 * package — the folder holding `lightsout-standards.json` — repo-relative or
	 * absolute. One key, not two: a package carries both the code and the test
	 * document trees, so a second key could only disagree with this one about
	 * which package is loaded. A root that cannot be loaded is a hard error.
	 */
	standardsPackages: z.union([z.array(z.string()), z.literal(false)]).optional(),
	/** Removed — replaced by `standardsPackages`. Declared only so a stale key fails loudly instead of being silently stripped. */
	standards: z.never('`standards` was replaced by `standardsPackages` — standards now load as packages').optional(),
	/** Removed — the test tree ships inside a standards package. Same reason. */
	testStandards: z.never('`testStandards` was replaced by `standardsPackages` — standards now load as packages').optional(),
	/**
	 * Framework channels of the loaded standards packages (e.g. 'react',
	 * 'tanstack'). Unspecified = detected per run from the scoped packages'
	 * package.json dependencies; an array REPLACES detection (empty = base
	 * docs only).
	 */
	standardsChannels: z.array(z.string()).optional(),
	/** Removed — renamed to `standardsChecks`. Declared only so a stale key fails loudly instead of being silently stripped. */
	scan: z.never('`scan` was renamed to `standardsChecks`').optional(),
	/**
	 * Per-rule overrides for `lightsout standards-check`, keyed by rule id. A
	 * value is either a severity, or an object with a severity and/or that
	 * rule's own settings. A rule not named here keeps its default — silence
	 * is never a change.
	 *
	 * The ids come from the loaded standards packages, so a mistyped one cannot
	 * be caught while parsing this file: `resolvePackageRuleStates` refuses a
	 * key naming no loaded rule and lists the valid ids. The protection is the
	 * same, it just happens where the answer exists. Read the live state with
	 * `lightsout standards-check --list`.
	 */
	standardsChecks: z
		.record(
			z.string(),
			z.union([
				standardsSeverityValue,
				z
					.object({
						severity: standardsSeverityValue.optional(),
						settings: z.record(z.string(), z.number()).optional(),
					})
					.strict(),
			]),
		)
		.optional(),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
