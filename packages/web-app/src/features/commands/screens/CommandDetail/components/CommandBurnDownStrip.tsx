import type { RunView } from '@lightsout/engine';
import { useQueries } from '@tanstack/react-query';
import { Card, MetadataTag } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { runQueryOptions } from '#src/features/runDetail/index.ts';

/** What a refactor run burned down: sites before and after, and how each batch ended. */
const refactorLine = ({ view }: { view: RunView }) => {
	const { before = 0, after = 0, batchesResolved = 0, batchesDeclined = 0 } = view.burnDown ?? {};

	return `${before} → ${after} findings · ${batchesResolved} resolved, ${batchesDeclined} declined`;
};

/**
 * What a coverage run measured: how many files, and the worst of them before
 * and after.
 *
 * The worst file rather than an average — `files` is already sorted worst
 * first, so picking one is a selection, and an average would be a number no
 * engine view owns.
 */
const coverageLine = ({ view }: { view: RunView }) => {
	const files = view.burnDown?.files ?? [];
	const worst = files[0];

	return worst === undefined
		? 'no files measured'
		: `${formatCount({ count: files.length, noun: 'file' })} · worst ${worst.path} ${worst.beforePct}% → ${worst.afterPct}%`;
};

interface Props {
	/** The runs to load a burn-down for, newest first. */
	runIds: string[];
	/** Coverage runs measure files rather than findings, so the strip reads their percentages instead. */
	coverage: boolean;
}

/**
 * The measured before-and-after of the most recent runs of this command.
 *
 * Each row is its own `getRun`, because a run's burn-down is computed from its
 * whole manifest rather than carried on the listing — which is why the caller
 * caps the list and this card says out loud how many it loaded.
 *
 * A run still in flight has no burn-down yet and simply does not appear.
 */
export const CommandBurnDownStrip = ({ runIds, coverage }: Props) => {
	const results = useQueries({ queries: runIds.map((runId) => runQueryOptions({ runId })) });
	const measured: RunView[] = results.flatMap((result) => (result.data?.burnDown === undefined ? [] : [result.data]));

	return measured.length === 0 ? null : (
		<Card title="Measured before and after">
			<div className="flex flex-col gap-2">
				{measured.map((view) => (
					<p key={view.listing.runId} className="flex flex-wrap items-center gap-2 text-sm">
						<MetadataTag>{view.listing.shortId}</MetadataTag>
						<span>{coverage ? coverageLine({ view }) : refactorLine({ view })}</span>
					</p>
				))}
			</div>
			<p className="mt-3 text-muted-foreground text-xs">The {formatCount({ count: runIds.length, noun: 'most recent run' })} of this command.</p>
		</Card>
	);
};
