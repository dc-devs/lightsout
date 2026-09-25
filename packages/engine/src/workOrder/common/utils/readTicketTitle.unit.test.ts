import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { readTicketTitle } from '#src/workOrder/common/utils/readTicketTitle.ts';

// Mocked Imports
// -------------------------
// `resolveTrackerSettings` stays real: what this file owns is that an unusable
// configuration stops the read before the network, and only the real resolver
// decides that. The fetch is doubled so the test can prove it never ran.
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
// -------------------------

/**
 * A repository that names a tracker but cannot reach it: the `ticket-tracker`
 * block is present and well formed, and the environment variable it names as
 * the API key is unset.
 */
const setupUnusableTracker = () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' },
	};

	return { config, env: {} };
};

/**
 * The same repository with its API key set, and the tracker answering whatever
 * the row needs: a failure, or the tickets it holds for the reference asked
 * about.
 */
const setupReachableTracker = ({ answer }: { answer: TrackerTicket[] | TrackerFailure }) => {
	const { config } = setupUnusableTracker();

	mockGetTicketsByIdentifiers.mockResolvedValue(answer);

	return { config, env: { LINEAR_API_KEY: 'lin_key' } };
};

describe('readTicketTitle', () => {
	test('readTicketTitle: an unusable tracker configuration is refused by name, with --title offered, before any request is made', async () => {
		const { config, env } = setupUnusableTracker();

		const answer = await readTicketTitle({ ticketRef: 'LO-158', config, env });

		expect(answer).toEqual({ error: expect.stringContaining('LINEAR_API_KEY') });
		expect(answer).toEqual({ error: expect.stringContaining('--title') });
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('a tracker that refuses the request is reported with the reference that was asked about', async () => {
		const { config, env } = setupReachableTracker({ answer: { error: 'the tracker answered 503' } });

		const answer = await readTicketTitle({ ticketRef: 'LO-158', config, env });

		// the tracker's own sentence is carried rather than replaced, so a 503 and
		// a bad credential do not read as the same failure
		expect(answer).toEqual({ error: expect.stringContaining('the tracker answered 503') });
		expect(answer).toEqual({ error: expect.stringContaining('LO-158') });
	});

	test('a reference the tracker holds no ticket for is refused, with --title offered rather than a guessed title', async () => {
		const { config, env } = setupReachableTracker({ answer: [] });

		const answer = await readTicketTitle({ ticketRef: 'LO-999', config, env });

		// a guess here would be a second author of the name, which is the one
		// thing this command exists to prevent
		expect(answer).toEqual({ error: expect.stringContaining('LO-999') });
		expect(answer).toEqual({ error: expect.stringContaining('--title') });
	});

	test("answers the title and the tracker's own spelling of the reference the caller typed in lower case", async () => {
		const { config, env } = setupReachableTracker({
			answer: [{ id: 'id-158', identifier: 'LO-158', title: "A ticket's branch name has no single author" } as TrackerTicket],
		});

		const answer = await readTicketTitle({ ticketRef: 'lo-158', config, env });

		// the record stores what comes back here, so `lo-158` typed at the terminal
		// is filed under the tracker's `LO-158`
		expect(answer).toStrictEqual({ ticketRef: 'LO-158', title: "A ticket's branch name has no single author" });
		expect(mockGetTicketsByIdentifiers.mock.calls[0]?.[0]?.identifiers).toStrictEqual(['lo-158']);
	});
});
