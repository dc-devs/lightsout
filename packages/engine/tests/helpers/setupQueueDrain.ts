import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { type QueueSettings, runQueue } from '#src/queue/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/** The real coordinator and repository; callers own their collaborator mocks. */
export const setupQueueDrain = ({
	repo,
	cwd = setupBranchRepo(repo).cwd,
	env = {},
}: {
	repo?: Parameters<typeof setupBranchRepo>[0];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
} = {}) => {
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };
	const relay = terminalRelayFixture();
	const progress: string[] = [];
	const drain = ({
		settings = queueSettingsFixture(),
		trackerSettings = trackerSettingsFixture(),
		ship = shipSettingsFixture(),
	}: {
		settings?: QueueSettings;
		trackerSettings?: TrackerSettings;
		ship?: ShipSettings;
	} = {}) =>
		runQueue({
			cwd,
			settings,
			trackerSettings,
			shipSettings: ship,
			config,
			env,
			driver,
			driverName: 'claude-code',
			relay,
			onProgress: (message) => progress.push(message),
		});

	return { cwd, drain, relay, progress };
};
