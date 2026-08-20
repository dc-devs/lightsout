import type { RunStepView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';

interface Params {
	/** Only what a test varies, over a step that passed on its first attempt. */
	overrides?: Partial<RunStepView>;
}

/** One step of a run, as the engine joins the manifest's record to what the agent ledger says it cost. */
export const buildRunStep = ({ overrides = {} }: Params = {}): RunStepView => ({
	id: 'implement',
	status: RunStatus.Passed,
	attempts: 1,
	durationMs: 360_000,
	changedFiles: ['src/a.ts'],
	invocations: 2,
	outputTokens: 12_400,
	costUsd: 1.5,
	...overrides,
});
