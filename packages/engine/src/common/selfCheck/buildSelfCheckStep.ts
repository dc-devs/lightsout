import { selfCheckStepPrefix } from '#src/common/selfCheck/selfCheckStepPrefix.ts';

interface Params {
	/** The pipeline step the self-check was invoked during, e.g. 'implement'. */
	step: string;
}

/**
 * The step name a self-check's gate executions are recorded under.
 *
 * That string decides both the per-test evidence directory the gate runner
 * clears and the `step` field on every command-log row — a self-check recorded
 * under the step itself would land in the following checkpoint's own evidence
 * namespace, where that checkpoint reads it back.
 */
export const buildSelfCheckStep = ({ step }: Params): string => `${selfCheckStepPrefix}${step}`;
