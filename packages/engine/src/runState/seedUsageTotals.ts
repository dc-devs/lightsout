import type { RunUsage } from '@lightsout/contracts';

interface Params {
	/** The manifest's persisted usage, when resuming — totals survive process boundaries. */
	usage?: RunUsage;
}

/** A run's live usage aggregate: zeros for a fresh run, the manifest's totals on resume. */
export const seedUsageTotals = ({ usage }: Params): RunUsage => ({
	invocations: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheCreationTokens: 0,
	costUsd: 0,
	...usage,
});
