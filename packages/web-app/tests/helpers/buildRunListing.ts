import type { RunListing } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';

interface Params {
	runId?: string;
	title?: string;
	status?: RunStatus;
	live?: boolean;
	/** Left out entirely by default, which is what a driver reporting no usage produces. */
	costUsd?: number;
}

/** One row of the runs list, filled in as the engine fills it, with only what a test cares about overridden. */
export const buildRunListing = ({
	runId = 'abcdef0123456789',
	title = 'add search',
	status = RunStatus.Passed,
	live = false,
	costUsd,
}: Params = {}): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline: 'implement',
	status,
	title,
	plan: '.lightsout/plans/add-search.md',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	live,
	packages: [],
	stepsPassed: 2,
	stepCount: 3,
	changedFileCount: 4,
	costUsd,
	resumable: false,
});
