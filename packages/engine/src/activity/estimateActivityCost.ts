import { gatherNodeProcesses } from '#src/activity/common/utils/gatherNodeProcesses.ts';
import type { ActivityNode, ConfigPricing } from '#src/contracts/index.ts';

interface Params {
	/** The level whose whole subtree is priced — its own harness process records and every descendant's. */
	node: ActivityNode;
	pricing?: ConfigPricing;
}

/** Each token count a process may report, beside the rate key that prices it. */
const pricedCounts = [
	{ count: 'inputTokens', rate: 'input' },
	{ count: 'outputTokens', rate: 'output' },
	{ count: 'cacheReadTokens', rate: 'cache-read' },
	{ count: 'cacheCreationTokens', rate: 'cache-write' },
] as const;

/**
 * The one place a configured rate meets a recorded token count.
 *
 * It answers `undefined` — never `0` — when there is no price list, when no
 * process in the subtree ran under a model the list names, or when no such
 * process reported any tokens at all. A missing rate read as a free agent would
 * be worse than no figure: a process killed at its ceiling that recovered
 * nothing would price as having spent nothing.
 *
 * A subtree mixing priced and unpriced processes answers the priced part, and
 * the renderer marks the row so a partial total is never read as a complete
 * one.
 *
 * It takes a node rather than a node id, so it needs nothing from the tree but
 * the shape the fold already returns — an id-keyed estimate map would have to
 * agree with the tree about identity, and two structures that can disagree
 * eventually do. It lives here rather than in the terminal's own renderer so a
 * later chart prices a record the same way this table does.
 */
export const estimateActivityCost = ({ node, pricing }: Params): number | undefined => {
	const tokensPerRate = 1_000_000;
	let priced = 0;
	let dollars = 0;

	for (const process of gatherNodeProcesses({ nodes: [node] })) {
		const rates = process.model === undefined ? undefined : pricing?.[process.model];

		if (rates === undefined) {
			continue;
		}

		for (const field of pricedCounts) {
			const tokens = process.usage?.[field.count];

			if (tokens !== undefined) {
				priced += 1;
				dollars += (tokens / tokensPerRate) * rates[field.rate];
			}
		}
	}

	return priced === 0 ? undefined : dollars;
};
