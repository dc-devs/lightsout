import { z } from 'zod';
import { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PackagesSource } from '#src/contracts/run/PackagesSource.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { RunUsage } from '#src/contracts/run/RunUsage.ts';
import { StepRecord } from '#src/contracts/run/StepRecord.ts';

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
	/** Path to the plan file the run implements, relative to the target repo. For a phases run this is the overview path. */
	plan: z.string(),
	/** Which pipeline owns this run. Absent on pre-discriminator manifests → implement. */
	pipeline: z.enum(PipelineKind).optional(),
	/** The ticket this run builds, e.g. 'LO-70'. Absent on a run started from a plan. */
	ticketRef: z.string().optional(),
	/** Optional overview plan (high-level context for a phased plan), relative to the target repo. */
	overview: z.string().optional(),
	/** Set on a phase's child run: the run id of the coordinator that started it. Absent on a top-level run, and on phase children recorded before this field existed. */
	parentRunId: z.string().optional(),
	/** Harness the run was started with (a resumed run must reuse it). */
	harness: z.string(),
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
	/** Step ids the run's pipeline declared at start, in order — what lets a reader show a row for a step the run has not reached. Absent on a pipeline that discovers its steps as it goes (refactor, coverage, phases) and on manifests written before this field existed. */
	stepOrder: z.array(z.string()).optional(),
	/** The git branch the run was started on, as git named it — the key a ship result is filed under. Absent on a detached HEAD, outside a worktree, and on manifests written before this field existed. */
	branch: z.string().optional(),
	/** Resolved before the run started: a passing run will ship this branch. Absent when no ship intent was resolved at all. */
	willShip: z.boolean().optional(),
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
	/** Public subject files resolved for the write-tests step — what verify fix re-invocations hand back to writers. */
	testSubjects: z.array(z.string()).default([]),
	/** Changed files the write-tests step skipped because nothing public reaches them; re-checked at run end. */
	unreachableChangedFiles: z.array(z.string()).default([]),
});

export type RunManifest = z.infer<typeof RunManifest>;
