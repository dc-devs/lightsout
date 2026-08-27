import { z } from 'zod';
import { RunStatus } from '#src/contracts/run/index.ts';

/**
 * One row of the runs list.
 *
 * Everything the list needs and nothing that requires opening a JSONL file, so
 * listing every run a repo has stays cheap however long its history gets.
 */
export const RunListing = z.object({
	runId: z.string(),
	/** First eight characters — the form every lightsout report prints and `resume --run` accepts. */
	shortId: z.string(),
	/** One of `PipelineKind`; a manifest predating the discriminator reads as `PipelineKind.Implement`. Kept a string so a row survives a value this engine does not know. */
	pipeline: z.string(),
	status: z.enum(RunStatus),
	/** Human label derived from the plan path — see getRunTitle. */
	title: z.string(),
	/** Repo-relative plan path, exactly as the manifest records it. */
	plan: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	/** A live process stands behind this run right now. */
	live: z.boolean(),
	packages: z.array(z.string()),
	stepsPassed: z.number(),
	stepCount: z.number(),
	changedFileCount: z.number(),
	/** Run-wide API-equivalent cost; absent for drivers that report no usage. */
	costUsd: z.number().optional(),
	/** Set on a phase's child run: the coordinator that started it. Copied from the run's own manifest. */
	parentRunId: z.string().optional(),
	/** A `resume --run` would do something: failed, either paused state, or running with no live process. */
	resumable: z.boolean(),
});

export type RunListing = z.infer<typeof RunListing>;
