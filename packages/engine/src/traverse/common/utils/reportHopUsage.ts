import type { invokeAgentWithContract } from '../../../invoke';

type HopUsage = Awaited<ReturnType<typeof invokeAgentWithContract>>['usage'];

interface Params {
	usage: HopUsage;
	/** The 1-based hop index shown to the user. */
	hopNumber: number;
	progress: (message: string) => void;
}

/**
 * Narrate a completed hop's token/cost usage, when the harness reported any.
 * Identical across the traverse and debug loops.
 */
export const reportHopUsage = ({ usage, hopNumber, progress }: Params): void => {
	if (!usage) {
		return;
	}

	progress(`hop ${hopNumber} usage: out ${usage.outputTokens} · cache-read ${usage.cacheReadTokens} · $${usage.costUsd.toFixed(2)}`);
};
