import { describe, expect, jest, test } from '@jest/globals';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { checkQueueStartup } from '#src/queue/startup/checkQueueStartup.ts';
import type { TrackerFailure, TrackerSettings } from '#src/ticketTracker/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The label catalog is the tracker's to answer and is covered by the seam's own
// tests. What this file owns is the two configuration refusals, both of which
// have to fire before the drain spends anything on git or a worktree.
const mockListLabelNames = jest.fn<(params: { settings: TrackerSettings }) => Promise<string[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({ listLabelNames: (params: { settings: TrackerSettings }) => mockListLabelNames(params) }));
// -------------------------
// Git is doubled at the one place the startup check reaches it, so the branch
// and remote refusals below are arranged from outside rather than from a real
// repository. `readGitDefaultBranch` stays real: what it reads out of the
// remote head is part of what this check answers.
interface RunCommandParams {
	command: string;
	cwd: string;
	timeoutMs?: number;
}

const mockRunCommand = jest.fn<(params: RunCommandParams) => Promise<CommandResult>>();

jest.mock('#src/common/processes/runCommand.ts', () => ({ runCommand: (params: RunCommandParams) => mockRunCommand(params) }));
// -------------------------

const shipSettings = shipSettingsFixture();
const everyLabel = ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'];

const check = ({ settings = queueSettingsFixture(), tracker = trackerSettingsFixture() }: { settings?: QueueSettings; tracker?: TrackerSettings } = {}) =>
	checkQueueStartup({ cwd: '/tmp/repo', settings, trackerSettings: tracker, shipSettings });

/**
 * A repository the two configuration refusals both pass: a tracker that knows
 * every configured planning-status label, and a remote whose head answers
 * `remoteHead`. An empty head is the repository that never had `origin/HEAD`.
 */
const setupReadyRepo = ({ remoteHead = 'origin/main' }: { remoteHead?: string } = {}) => {
	mockListLabelNames.mockResolvedValue(everyLabel);
	mockRunCommand.mockResolvedValue({ exitCode: 0, stdout: remoteHead, stderr: '' });
};

/** The same ready repository, with the one fetch git refuses to spawn at all. */
const setupUnfetchableRemote = () => {
	setupReadyRepo();
	mockRunCommand.mockImplementation(({ command }) => {
		if (command === 'git fetch origin') {
			return Promise.reject(new Error('spawn git ENOENT'));
		}

		return Promise.resolve({ exitCode: 0, stdout: 'origin/main', stderr: '' });
	});
};

/** The one sentence the refusal is, whichever branch produced it. */
const errorOf = (started: { error: string } | { defaultBranch: string }) => ('error' in started ? started.error : '');

describe('checkQueueStartup', () => {
	test('refuses a ready status the eligible query never asks for, naming both keys — implementation-ready work would otherwise be silently unrunnable', async () => {
		const settings = queueSettingsFixture();
		const started = await check({ settings: { ...settings, lifecycle: { ...settings.lifecycle, eligibleStatuses: ['Backlog'] } } });

		expect(errorOf(started)).toContain('`queue.ready-status`');
		expect(errorOf(started)).toContain('`queue.eligible-statuses`');
		// the refusal costs nothing to discover: the tracker is never asked
		expect(mockListLabelNames).not.toHaveBeenCalled();
	});

	test('refuses a configured planning status label the tracker does not know, naming every missing one', async () => {
		mockListLabelNames.mockResolvedValue(['planning-complete', 'planning-not-needed']);

		expect(errorOf(await check())).toContain("'planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan'");
	});

	test('tells a Linear user to create the missing label on the team', async () => {
		mockListLabelNames.mockResolvedValue(everyLabel.slice(1));

		expect(errorOf(await check())).toContain('create it on the team');
	});

	test('tells a Jira user to apply the missing label to an issue, because a Jira label has no create action of its own', async () => {
		mockListLabelNames.mockResolvedValue(everyLabel.slice(1));

		expect(errorOf(await check({ tracker: jiraTrackerSettingsFixture() }))).toContain('apply it to any issue in the project');
	});

	test('hands a catalog read failure back unchanged, so a bad key never reads as a missing label', async () => {
		mockListLabelNames.mockResolvedValue({ error: 'authentication failed' });

		expect(await check()).toStrictEqual({ error: 'authentication failed' });
	});

	test('refuses a branch template the ship pattern cannot read, naming both keys and the branch it rendered', async () => {
		setupReadyRepo();

		const started = await check({ settings: queueSettingsFixture({ branchTemplate: 'wip/{slug}' }) });

		expect(errorOf(started)).toContain('`queue.branch-template`');
		expect(errorOf(started)).toContain('`ship.ticket-pattern`');
		expect(errorOf(started)).toContain("renders 'wip/sample'");
	});

	test('shapes the sample branch from the configured tracker prefix, so a pattern scoped to one project is not false-alarmed', async () => {
		setupReadyRepo();
		const tracker = trackerSettingsFixture({ ticketPrefix: 'ACME' });

		const started = await check({ settings: queueSettingsFixture({ branchTemplate: 'wip/{ticket}' }), tracker });

		expect(errorOf(started)).toContain("renders 'wip/acme-1'");
	});

	test('refuses when the remote head is unset, naming the command that sets it', async () => {
		setupReadyRepo({ remoteHead: '' });

		expect(errorOf(await check())).toContain('git remote set-head origin --auto');
	});

	test('answers the remote default branch with the `origin/` prefix stripped', async () => {
		setupReadyRepo({ remoteHead: 'origin/trunk' });

		expect(await check()).toStrictEqual({ defaultBranch: 'trunk' });
	});

	test('fetches origin once for the whole drain, so every worktree creation builds on the one fetch', async () => {
		setupReadyRepo();

		await check();

		expect(mockRunCommand.mock.calls.map(([{ command }]) => command)).toStrictEqual(['git rev-parse --abbrev-ref origin/HEAD', 'git fetch origin']);
	});

	test('starts the drain even when the fetch fails — a stale remote is no reason to refuse the whole queue', async () => {
		setupUnfetchableRemote();

		expect(await check()).toStrictEqual({ defaultBranch: 'main' });
	});
});
