import { z } from 'zod';

/**
 * Consumer configuration (`lightsout.config.json` at the target repo root).
 * This is the only coupling point between the engine and a consumer — the
 * engine never knows a consumer by name.
 */
export const LightsoutConfig = z.object({
	/** Driver name. Defaults to 'claude-code'. */
	driver: z.string().optional(),
	/** Model override passed through to the harness. */
	model: z.string().optional(),
	/** Harness permission mode for agent invocations. Defaults to 'acceptEdits'. */
	permissionMode: z.string().optional(),
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
	/** Repo-relative markdown files inlined as binding standards for code-writing roles (executor, refactorer). A missing file is a hard error. */
	standards: z.array(z.string()).optional(),
	/** Same, for the test-writer role. */
	testStandards: z.array(z.string()).optional(),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
