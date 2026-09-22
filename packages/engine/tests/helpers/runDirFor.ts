import { join } from 'node:path';

/**
 * Which command folder holds a run of each pipeline.
 *
 * Spelled here rather than imported from the engine, so a fixture states the
 * layout it expects instead of borrowing the answer from the code under test.
 */
const commandFolders: Record<string, string> = {
	implement: 'implement',
	phases: 'implement',
	direct: 'direct',
	refactor: 'refactor',
	coverage: 'coverage',
	queue: 'queue',
};

interface Params {
	/** The checkout whose state directory holds the run. */
	cwd: string;
	runId: string;
	/** The plan the run belongs to — an address `<ticket-branch>/<plan-id>`, or a legacy folder's bare slug. */
	planName?: string;
	/** The ticket branch a run belonging to no plan is filed under. */
	workOrderName?: string;
	/** The pipeline that owns a run belonging to no ticket at all; absent reads as implement. */
	pipeline?: string;
}

/**
 * Where a seeded run's folder goes: under its ticket when the run belongs to
 * one, and under the command that owns it otherwise.
 */
export const runDirFor = ({ cwd, runId, planName, workOrderName, pipeline }: Params): string => {
	const ticket = planName === undefined ? workOrderName : planName.split('/')[0];
	const runsDir =
		ticket === undefined ? join('.lightsout', commandFolders[pipeline ?? 'implement'], 'runs') : join('.lightsout', 'work-orders', ticket, 'runs');

	return join(cwd, runsDir, runId);
};
