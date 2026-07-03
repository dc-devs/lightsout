import { z } from 'zod';
import { LightsoutConfig } from './LightsoutConfig';
import { PackagesSource } from './PackagesSource';
import { RunStatus } from './RunStatus';
import { RunUsage } from './RunUsage';
import { StepRecord } from './StepRecord';

/**
 * The on-disk state of a run (`.lightsout/runs/<id>/manifest.json`).
 *
 * State lives here, not in any model's context window — this is what makes
 * runs crash-safe, rate-limit-safe, and resumable at the failed step.
 */
export const RunManifest = z.object({
	runId: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	/** Path to the plan file the run implements, relative to the target repo. */
	plan: z.string(),
	/** Optional overview plan (high-level context for a phased plan), relative to the target repo. */
	overview: z.string().optional(),
	/** Driver name the run was started with (a resumed run must reuse it). */
	driver: z.string(),
	/**
	 * Snapshot of the resolved config at run creation — the permanent record
	 * of which settings produced this run. Resume EXECUTES with the current
	 * config file; this records what the run started with.
	 */
	config: LightsoutConfig.optional(),
	status: z.enum(RunStatus),
	/** Step id currently executing, or null when no step is in flight. */
	currentStep: z.string().nullable(),
	steps: z.array(StepRecord),
	/** Source files changed so far, accumulated across steps. */
	changedFiles: z.array(z.string()),
	/**
	 * Package scope (directory names under the packages dir) for scoped
	 * gates. Seeded from the plan front-matter or `--packages`, then expanded
	 * as changed files reveal the true blast radius — never shrunk. Empty in
	 * non-monorepo mode.
	 */
	packages: z.array(z.string()).default([]),
	/** Where the initial package scope came from — recorded so a derived scope is never mistaken for a declared one. */
	packagesSource: z.enum(PackagesSource).optional(),
	/**
	 * Aggregate agent usage across the whole run (per-invocation detail lives
	 * in the run dir's `agents.jsonl`). Absent for drivers reporting nothing.
	 */
	usage: RunUsage.optional(),
	/**
	 * Paths already dirty/untracked in git when the run started. Subtracted
	 * from every git snapshot so only files the RUN changed are attributed to
	 * it — agents report what they changed, git reports what actually changed.
	 */
	baselineDirtyFiles: z.array(z.string()).default([]),
});

export type RunManifest = z.infer<typeof RunManifest>;
