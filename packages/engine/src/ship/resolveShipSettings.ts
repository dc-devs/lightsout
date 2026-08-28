import { type LightsoutConfig, ShipMergeMethod } from '#src/contracts/index.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';

interface Params {
	config: LightsoutConfig;
}

/** The compiled pattern, or undefined when the source is not a regular expression at all. */
const compilePattern = ({ source }: { source: string }) => {
	try {
		return new RegExp(source);
	} catch {
		return undefined;
	}
};

/**
 * The `ship` block with its defaults applied, or undefined when the configured
 * ticket pattern cannot do its job.
 *
 * A pattern that is not a valid regular expression, or one that captures no
 * `ticket` group, makes every branch unshippable — so it is refused here, once,
 * at startup. The callers turn that into a usage error naming the key rather
 * than into a result file, because a result file records a run and no run
 * happened.
 */
export const resolveShipSettings = ({ config }: Params): ShipSettings | undefined => {
	const ship = config.ship;
	const ticketPattern = compilePattern({ source: ship?.['ticket-pattern'] ?? String.raw`^(?<ticket>[a-z]+-\d+)` });

	if (ticketPattern === undefined || !ticketPattern.source.includes('(?<ticket>')) {
		return undefined;
	}

	return {
		ticketPattern,
		pullRequestBody: ship?.['pr-body'] ?? '{ticket}',
		mergeMethod: ship?.['merge-method'] ?? ShipMergeMethod.Merge,
		afterImplement: ship?.['after-implement'] ?? false,
	};
};
