import { selfCheckStepPrefix } from '#src/common/selfCheck/selfCheckStepPrefix.ts';

interface Params {
	/** A command-log row's `step`, absent on records written outside a step. */
	step: string | undefined;
}

/**
 * Was this record written by an agent's own self-check rather than by the run's
 * gate work?
 *
 * The companion of `buildSelfCheckStep`, kept beside it because the gates module
 * writes the name and the run-state module reads it — and the gates module
 * already imports the run-state module, so a dependency the other way round
 * would be a cycle.
 */
export const isSelfCheckStep = ({ step }: Params): boolean => step?.startsWith(selfCheckStepPrefix) ?? false;
