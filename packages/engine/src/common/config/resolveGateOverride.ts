import type { GateOverride, LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	overrides: LightsoutConfig['gate-overrides'];
	/** The verification checkpoint in flight: 'clean-slate', 'verify-implement', 'verify-tests' or 'verify-refactor'. */
	checkpoint: string;
}

/**
 * One checkpoint's `gate-overrides` entry, or `undefined` when the block does
 * not list it — in which case the checkpoint keeps the engine's default
 * schedule.
 *
 * The block's keys are literal, so the entry is found by walking them rather
 * than by indexing with the checkpoint: a cast to index a fixed shape by an
 * arbitrary string would accept a checkpoint name nothing declares.
 */
export const resolveGateOverride = ({ overrides, checkpoint }: Params): GateOverride | undefined =>
	Object.entries(overrides ?? {}).find(([key]) => key === checkpoint)?.[1];
