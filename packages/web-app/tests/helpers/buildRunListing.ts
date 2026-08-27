import type { RunListing } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';

interface Params {
	runId?: string;
	title?: string;
	/** Kept a plain string, as the contract does, so a test can hand over a pipeline this app does not know. */
	pipeline?: string;
	status?: RunStatus;
	live?: boolean;
	/** Left out entirely by default, which is what a driver reporting no usage produces. */
	costUsd?: number;
	/** Left out entirely by default: only a phase's child run names the coordinator that started it. */
	parentRunId?: string;
	/** Empty by default, which is what a repo that is not a monorepo produces. */
	packages?: string[];
	stepsPassed?: number;
	changedFileCount?: number;
	updatedAt?: string;
	/** False by default: only a stopped run the manifest says can be picked back up carries a resume command. */
	resumable?: boolean;
}

/** One row of the runs list, filled in as the engine fills it, with only what a test cares about overridden. */
export const buildRunListing = ({
	runId = 'abcdef0123456789',
	title = 'add search',
	pipeline = PipelineKind.Implement,
	status = RunStatus.Passed,
	live = false,
	costUsd,
	parentRunId,
	packages = [],
	stepsPassed = 2,
	changedFileCount = 4,
	updatedAt = '2026-01-01T00:00:00.000Z',
	resumable = false,
}: Params = {}): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline,
	status,
	title,
	plan: '.lightsout/plans/add-search.md',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt,
	live,
	packages,
	stepsPassed,
	stepCount: 3,
	changedFileCount,
	costUsd,
	parentRunId,
	resumable,
});
