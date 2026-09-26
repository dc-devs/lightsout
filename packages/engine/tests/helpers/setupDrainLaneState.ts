import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/** An idle scheduler ledger and controlled collaborators for direct lane tests. */
export const setupDrainLaneState = ({ maxParallel = 2 }: { maxParallel?: number } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-lane-state-'));
	const runWorkOrder = jest
		.fn<(params: { workOrder: NamedWorkOrder }) => Promise<WorkOrderRunOutcome>>()
		.mockImplementation(async ({ workOrder }) => queueOutcomeFixture({ ticket: workOrder.ticket }));
	const progress: string[] = [];
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	/** No repository these lane tests stand up has ever timed out waiting for the machine. */
	const holds: GateHolds = {};
	const context = {
		cwd,
		config,
		runId: 'lane-drain-1',
		holds,
		settings: queueSettingsFixture({ maxParallel }),
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		shipIntegration: shipIntegrationFixture(),
		/** Naming is either mocked or not reached in a lane test, so a spawned harness is a failure rather than a silent pass. */
		driver: createUncalledDriver({ reason: 'a lane test spawned the name summariser' }),
		defaultBranch: 'main',
		env: {},
		planPath: join(cwd, 'queue.md'),
		runWorkOrder,
		serializeMainCheckout: <Result>({ task }: { task: () => Promise<Result> }) => task(),
		/** No lane helper records the board — the drain does, once per pass. */
		board: { record: () => undefined },
		onProgress: (message: string) => progress.push(message),
	};
	const state = {
		pending: [] as NamedWorkOrder[],
		queued: [] as NamedWorkOrder[],
		building: new Map<string, { workOrder: NamedWorkOrder; startedAt: string }>(),
		readyToShip: [] as WorkOrderRunOutcome[],
		shipping: undefined as WorkOrderRunOutcome | undefined,
		outcomes: [] as WorkOrderRunOutcome[],
		leftBehind: [] as QueueDrainReport['leftBehind'],
		attempted: new Set<string>(),
		blockedByIdentifier: new Map<string, QueueDrainReport['leftBehind'][number]>(),
		retired: 0,
		rescanRequested: false,
		idleScanSpent: false,
		scansStopped: false,
	};
	const flight = { tasks: new Map<number, Promise<number>>(), builds: 0, ships: 0, scans: 0, nextKey: 0 };

	return { context, state, flight, runWorkOrder, progress };
};
