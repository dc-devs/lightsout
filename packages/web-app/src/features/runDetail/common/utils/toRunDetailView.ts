import type { RunView } from '@lightsout/engine';
import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';

interface Params {
	/** A run view exactly as the engine assembled it. */
	view: RunView;
}

/**
 * Narrow a run view for the wire: each step's report keeps its value and loses
 * only the `unknown` in its type.
 *
 * A report that is no object at all is dropped rather than carried, because
 * every report contract the engine writes is an object — a primitive in that
 * field is a corrupt manifest, and the step then reads as having recorded
 * nothing rather than as holding something the page cannot show.
 */
export const toRunDetailView = ({ view }: Params): RunDetailView => ({
	...view,
	steps: view.steps.map((step) => ({
		...step,
		report: typeof step.report === 'object' && step.report !== null ? step.report : undefined,
	})),
});
