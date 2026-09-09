import { describe, expect, jest, test } from '@jest/globals';
import { writeGateBlockedLabel } from '#src/gates/gateHolds/common/utils/writeGateBlockedLabel.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Resolving an identifier to a tracker id and writing one label by name are
// each covered by their own tests. What this file owns is that the label
// written is the blocked one, added rather than removed, against the id the
// read answered — and that an identifier the tracker does not know writes
// nothing at all.
type ReadParams = { settings: TrackerSettings; identifiers: string[] };
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };

const mockGetTicketsByIdentifiers = jest.fn<(params: ReadParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: ReadParams) => mockGetTicketsByIdentifiers(params),
	setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params),
}));
// -------------------------

const ticketOf = ({ id, identifier }: { id: string; identifier: string }): TrackerTicket => ({
	id,
	identifier,
	title: 'Gate runs pile onto one machine',
	description: '',
	priority: 2,
	createdAt: '2026-09-01T00:00:00.000Z',
	labels: [],
	status: 'In Progress',
	finished: false,
	unfinishedBlockers: [],
});

const setupBlockedLabel = ({ tickets = [], readFailure }: { tickets?: TrackerTicket[]; readFailure?: string } = {}) => {
	mockGetTicketsByIdentifiers.mockResolvedValue(readFailure === undefined ? tickets : { error: readFailure });
	mockSetTicketLabel.mockResolvedValue(undefined);

	return { settings: trackerSettingsFixture() };
};

describe('writeGateBlockedLabel', () => {
	test('writes the blocked label by resolved ticket id, and names an unknown identifier', async () => {
		const { settings } = setupBlockedLabel({ tickets: [ticketOf({ id: 'linear-internal-id', identifier: 'LO-119' })] });

		const written = await writeGateBlockedLabel({ settings, identifier: 'LO-119' });

		expect(written).toBe(undefined);
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ settings, identifiers: ['LO-119'] }));
		// the tracker's own id, never the human reference — Linear addresses a ticket by id
		expect(mockSetTicketLabel).toHaveBeenCalledWith(
			expect.objectContaining({ settings, ticketId: 'linear-internal-id', label: 'queue-blocked-gate-timed-out', present: true }),
		);

		const { settings: unknownSettings } = setupBlockedLabel({ tickets: [] });

		const refused = await writeGateBlockedLabel({ settings: unknownSettings, identifier: 'LO-404' });

		expect(refused).toEqual(expect.stringContaining('LO-404'));
		// still one call in total: the unknown identifier wrote nothing
		expect(mockSetTicketLabel).toHaveBeenCalledTimes(1);
	});

	test('names a failed lookup and writes no label', async () => {
		const { settings } = setupBlockedLabel({ readFailure: 'Linear answered 503' });

		const written = await writeGateBlockedLabel({ settings, identifier: 'LO-119' });

		// the id the write needs never arrived, so there is nothing to address the
		// label to — and the caller has to be told, because the hold it just recorded
		// is still unconfirmed and has to keep blocking until this write lands
		expect(written).toEqual(expect.stringContaining('Linear answered 503'));
		expect(mockSetTicketLabel).not.toHaveBeenCalled();
	});
});
