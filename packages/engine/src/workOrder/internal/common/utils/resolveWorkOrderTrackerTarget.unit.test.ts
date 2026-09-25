import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { resolveWorkOrderTrackerTarget } from '#src/workOrder/internal/common/utils/resolveWorkOrderTrackerTarget.ts';

/**
 * A repository that can reach its tracker: the `ticket-tracker` block names the
 * team and the variable, and the environment holds the key that variable names.
 *
 * The tracker is usable in both halves of the test on purpose — what decides
 * `localOnly` there is the work order's own record carrying no ticket
 * reference, not anything about the configuration.
 */
const setupConfiguredTracker = (): { config: LightsoutConfig; env: NodeJS.ProcessEnv } => ({
	config: {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' },
	},
	env: { LINEAR_API_KEY: 'lin_key' },
});

describe('resolveWorkOrderTrackerTarget', () => {
	test('answers local-only for a work order that belongs to no ticket', () => {
		const { config, env } = setupConfiguredTracker();

		const answers = {
			noTicketRef: resolveWorkOrderTrackerTarget({ config, env, workOrderName: 'add-search-basics', ticketRef: undefined }),
			withTicketRef: resolveWorkOrderTrackerTarget({ config, env, workOrderName: 'lo-158-give-the-name-one', ticketRef: 'LO-158' }),
		};

		expect(answers).toEqual({
			noTicketRef: { localOnly: expect.stringContaining('add-search-basics') },
			withTicketRef: {
				settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
				ticketRef: 'LO-158',
			},
		});
	});
});
