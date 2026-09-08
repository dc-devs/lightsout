import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueDrainReport, TicketRunOutcome } from '#src/queue/index.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import type { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/** An idle scheduler ledger and controlled collaborators for direct lane tests. */
export const setupDrainLaneState = ({ maxParallel = 2 }: { maxParallel?: number } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-lane-state-'));
	const runTicket = jest
		.fn<(params: { ticket: ReturnType<typeof queueTicketFixture> }) => Promise<TicketRunOutcome>>()
		.mockImplementation(async ({ ticket }) => queueOutcomeFixture({ ticket }));
	const progress: string[] = [];
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	const context = {
		cwd,
		config,
		settings: queueSettingsFixture({ maxParallel }),
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		defaultBranch: 'main',
		env: {},
		planPath: join(cwd, 'queue.md'),
		runTicket,
		serializeMainCheckout: <Result>({ task }: { task: () => Promise<Result> }) => task(),
		onProgress: (message: string) => progress.push(message),
	};
	const state = {
		pending: [] as ReturnType<typeof queueTicketFixture>[],
		queued: [] as ReturnType<typeof queueTicketFixture>[],
		readyToShip: [] as TicketRunOutcome[],
		outcomes: [] as TicketRunOutcome[],
		leftBehind: [] as QueueDrainReport['leftBehind'],
		attempted: new Set<string>(),
		blockedByIdentifier: new Map<string, QueueDrainReport['leftBehind'][number]>(),
		retired: 0,
		rescanRequested: false,
		idleScanSpent: false,
		scansStopped: false,
	};
	const flight = { tasks: new Map<number, Promise<number>>(), builds: 0, ships: 0, scans: 0, nextKey: 0 };

	return { context, state, flight, runTicket, progress };
};
