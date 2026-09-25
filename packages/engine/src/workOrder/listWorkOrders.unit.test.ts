import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { listWorkOrders } from '#src/workOrder/listWorkOrders.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** A state the contract accepts, written by hand so the listing is the only thing under test. */
const workOrderStateOf = ({ name, ticketRef }: { name: string; ticketRef: string }) =>
	JSON.stringify({
		schemaVersion: 1,
		name,
		branch: name,
		ticketRef,
		mode: 'multiple-plan',
		plans: [],
		history: [],
	});

/**
 * A checkout with no repository above it, holding one work-order folder per
 * entry: a string is that folder's `state.json`, and `undefined` is a folder
 * holding no record at all. `files` writes plain files directly into the
 * work-orders directory, beside those folders.
 */
const setupWorkOrders = async ({ folders = {}, files = {} }: { folders?: Record<string, string | undefined>; files?: Record<string, string> } = {}) => {
	const cwd = await freshCwd();
	const workOrders = join(cwd, '.lightsout', 'work-orders');

	for (const [name, contents] of Object.entries(folders)) {
		const folder = join(workOrders, name);

		await mkdir(folder, { recursive: true });

		if (contents !== undefined) {
			await writeFile(join(folder, 'state.json'), contents, 'utf8');
		}
	}

	for (const [name, contents] of Object.entries(files)) {
		await mkdir(workOrders, { recursive: true });
		await writeFile(join(workOrders, name), contents, 'utf8');
	}

	return { cwd };
};

describe('listWorkOrders', () => {
	test('listWorkOrders: sorts readable records into found and names every folder it could not read in unreadable', async () => {
		const { cwd } = await setupWorkOrders({
			folders: {
				'lo-9-rank-the-results': workOrderStateOf({ name: 'lo-9-rank-the-results', ticketRef: 'LO-9' }),
				'lo-2-give-the-name-one': workOrderStateOf({ name: 'lo-2-give-the-name-one', ticketRef: 'LO-2' }),
				'lo-7-holds-no-record': undefined,
				'lo-4-will-not-parse': '{ not json',
			},
		});

		const listing = await listWorkOrders({ cwd });

		// a folder the listing dropped is a work order creation cannot see, which is how one ticket gets two work orders
		expect({
			found: listing.found.map((entry) => ({ name: entry.name, ticketRef: entry.record.ticketRef })),
			unreadable: listing.unreadable,
		}).toStrictEqual({
			found: [
				{ name: 'lo-2-give-the-name-one', ticketRef: 'LO-2' },
				{ name: 'lo-9-rank-the-results', ticketRef: 'LO-9' },
			],
			unreadable: ['lo-4-will-not-parse', 'lo-7-holds-no-record'],
		});
	});

	test('listWorkOrders: a repository with no work-orders directory answers an empty found list and an empty unreadable list', async () => {
		const cwd = await freshCwd();

		const listing = await listWorkOrders({ cwd });

		expect(listing).toStrictEqual({ found: [], unreadable: [] });
	});

	test('listWorkOrders: ignores a plain file sitting beside the work-order folders rather than naming it unreadable', async () => {
		const { cwd } = await setupWorkOrders({
			folders: { 'lo-3-rank-the-results': workOrderStateOf({ name: 'lo-3-rank-the-results', ticketRef: 'LO-3' }) },
			files: { '.DS_Store': 'not a work order', 'notes.md': 'not a work order either' },
		});

		const listing = await listWorkOrders({ cwd });

		// a file named in `unreadable` would refuse creation forever, because no folder is there to repair or remove
		expect({ found: listing.found.map((entry) => entry.name), unreadable: listing.unreadable }).toStrictEqual({
			found: ['lo-3-rank-the-results'],
			unreadable: [],
		});
	});
});
