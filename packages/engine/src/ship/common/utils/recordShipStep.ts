import type { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';
import type { ShippingProgressRecorder } from '#src/ship/progress/ShippingProgressRecorder.ts';

/**
 * One step of a ship attempt, recorded as it starts and as it finishes — passed
 * or failed by the step's own answer. A step that stops the attempt is finished
 * failed before its stop is returned, and the steps after it stay untouched.
 */
export const recordShipStep = async <Answer>({
	recorder,
	step,
	run,
	passed,
}: {
	recorder: ShippingProgressRecorder;
	step: ShippingStepId;
	run: () => Promise<Answer>;
	passed: (answer: Answer) => boolean;
}): Promise<Answer> => {
	recorder.startStep({ step });

	const answer = await run();

	recorder.finishStep({ step, passed: passed(answer) });

	return answer;
};
