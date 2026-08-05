import { z } from 'zod';
import { Effort } from './Effort';
import { Permissions } from './Permissions';

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
	/** Where committed plan deliverables live (`plan draft` output). Default '.claude/plans'. */
	plansDir: z.string().optional(),
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
	 * Standards for code-writing roles (executor, refactorer). Unspecified =
	 * the engine's bundled JS/TS defaults load (announced in the run header);
	 * `false` = explicitly none; an array = exactly these, where each entry
	 * is a repo-relative markdown file, a repo-relative folder (every `.md`
	 * under it, recursively, in sorted path order), or the token
	 * `lightsout:code-defaults` to stack the bundled defaults with extras. A
	 * missing entry — or a folder holding no markdown — is a hard error.
	 */
	standards: z.union([z.array(z.string()), z.literal(false)]).optional(),
	/** Same, for the test-writer role (token: `lightsout:test-defaults`). */
	testStandards: z.union([z.array(z.string()), z.literal(false)]).optional(),
	/**
	 * Framework channels of the bundled default standards (e.g. 'react',
	 * 'tanstack'). Unspecified = detected per run from the scoped packages'
	 * package.json dependencies; an array REPLACES detection (empty = base
	 * docs only).
	 */
	standardsChannels: z.array(z.string()).optional(),
	/** `lightsout scan` tuning — per-repo floors, not global guesses. */
	scan: z
		.object({
			/** Minimum jscpd token span for a tier-1 clone finding (default 50). */
			minCloneTokens: z.number().int().positive().optional(),
			/** Line-cap overrides for the size detector (defaults: file 250, tsxFile 300, function 80, hook 160, component 200). */
			size: z
				.object({
					file: z.number().int().positive().optional(),
					tsxFile: z.number().int().positive().optional(),
					function: z.number().int().positive().optional(),
					hook: z.number().int().positive().optional(),
					component: z.number().int().positive().optional(),
				})
				.optional(),
		})
		.optional(),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
