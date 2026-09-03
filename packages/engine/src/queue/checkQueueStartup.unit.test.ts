import { describe, expect, jest, test } from '@jest/globals';
import { checkQueueStartup } from '#src/queue/checkQueueStartup.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
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

const shipSettings = shipSettingsFixture();
const everyLabel = ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'];

const check = ({ settings = queueSettingsFixture(), tracker = trackerSettingsFixture() }: { settings?: QueueSettings; tracker?: TrackerSettings } = {}) =>
	checkQueueStartup({ cwd: '/tmp/repo', settings, trackerSettings: tracker, shipSettings });

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
});
