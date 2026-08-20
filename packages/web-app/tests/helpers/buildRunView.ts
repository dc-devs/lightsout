import type { RunView } from '@lightsout/engine';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';

interface Params {
	/** Only what a test varies, over a run that passed with nothing remarkable in it. */
	overrides?: Partial<RunView>;
}

/** One run's whole evidence, shaped as the engine assembles it, with nothing in it a test did not ask for. */
export const buildRunView = ({ overrides = {} }: Params = {}): RunView => ({
	listing: buildRunListing(),
	harness: 'claude-code',
	currentStep: null,
	wallMs: 900_000,
	activeMs: 720_000,
	gateMs: 120_000,
	steps: [],
	gates: [],
	gateTotals: { commands: 0, reruns: 0, skipped: 0 },
	agents: [],
	rejectedReports: 0,
	friction: [],
	changedFiles: [],
	unreachableChangedFiles: [],
	...overrides,
});
