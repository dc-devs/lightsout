import { z } from 'zod';
import { FrictionRecord } from '#src/contracts/friction/index.ts';
import { RunUsage } from '#src/contracts/run/index.ts';
import { AgentInvocation } from '#src/contracts/views/AgentInvocation.ts';
import { GateEvidence } from '#src/contracts/views/GateEvidence.ts';
import { RunListing } from '#src/contracts/views/RunListing.ts';
import { RunStepView } from '#src/contracts/views/RunStepView.ts';

/** One run's whole evidence, assembled: timing, steps, gates, agent spend, friction and files. */
export const RunView = z.object({
	listing: RunListing,
	harness: z.string(),
	/**
	 * Overview plan path, repo-relative: `manifest.overview` on a phase's child
	 * run; on the coordinator itself (`pipeline: 'phases'`), whose manifest
	 * carries no `overview` field, this is `manifest.plan` — initializeSequence
	 * records the overview as the coordinator's plan.
	 */
	overview: z.string().optional(),
	currentStep: z.string().nullable(),
	/** Wall clock across the run, including idle gaps between a failure and its resume. */
	wallMs: z.number(),
	/** Sum of step durations — actual working time. */
	activeMs: z.number(),
	gateMs: z.number(),
	usage: RunUsage.optional(),
	/** Share of all input the model read from cache. */
	cacheReadShare: z.number().optional(),
	steps: z.array(RunStepView),
	gates: z.array(GateEvidence),
	gateTotals: z.object({ commands: z.number(), reruns: z.number(), skipped: z.number() }),
	agents: z.array(AgentInvocation),
	/** Final messages that failed their contract and cost a re-emit retry. */
	rejectedReports: z.number(),
	friction: z.array(FrictionRecord),
	changedFiles: z.array(z.string()),
	unreachableChangedFiles: z.array(z.string()),
	/** Set on a phase's child run: the coordinator that spawned it. */
	parent: z.object({ runId: z.string(), step: z.string(), title: z.string() }).optional(),
});

export type RunView = z.infer<typeof RunView>;
