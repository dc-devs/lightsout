import type { PipelineResult } from './PipelineResult';

export interface PipelineStep {
	id: string;
	/** Returns a skip reason when the step has nothing to do (recorded, counted as passed). */
	skip?: () => string | undefined;
	run: () => Promise<PipelineResult | undefined>;
}
