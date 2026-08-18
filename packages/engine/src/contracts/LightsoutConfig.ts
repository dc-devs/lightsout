import { z } from 'zod';
import { ConfigCommands } from '@/contracts/ConfigCommands';
import { ConfigGates } from '@/contracts/ConfigGates';
import { Effort } from '@/contracts/Effort';
import { PackageGates } from '@/contracts/PackageGates';
import { Permissions } from '@/contracts/Permissions';
import { StandardsCheckOverrides } from '@/contracts/StandardsCheckOverrides';

/**
 * Consumer configuration (`lightsout.config.json` at the target repo root).
 * This is the only coupling point between the engine and a consumer — the
 * engine never knows a consumer by name.
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
	driver: z.never('`driver` was renamed to `harness`').optional(),
	/** Removed — replaced by `permissions`. Same reason. */
	permissionMode: z.never('`permissionMode` was replaced by `permissions` (`write` or `full-access`)').optional(),
	/** Removed — renamed to `gates`. Same reason. */
	scripts: z.never('`scripts` was renamed to `gates`').optional(),
	/** Removed — renamed to `packageGates`. Same reason. */
	packageScripts: z.never('`packageScripts` was renamed to `packageGates`').optional(),
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
	/**
	 * Path to the JSON coverage summary the coverage tooling writes (default
	 * `coverage/coverage-summary.json`) — repo-relative in single-package
	 * repos, package-relative in monorepo mode. `lightsout
	 * test-coverage-to-threshold` reads per-file percentages from it; the file
	 * is the tool-agnostic contract, so a printed coverage table changing
	 * format never breaks the run.
	 */
	coverageSummaryPath: z.string().optional(),
	/** Directory holding workspace packages, for monorepo scoped gates. Default 'packages'. */
	packagesDir: z.string().optional(),
	/** Monorepo scoped gate templates. See `PackageGates`. */
	packageGates: PackageGates.optional(),
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
	/** Per-rule severity/settings overrides. See `StandardsCheckOverrides`. */
	standardsChecks: StandardsCheckOverrides.optional(),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
