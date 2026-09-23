import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { findWorkOrderByTicketRef } from '#src/workOrder/index.ts';

/**
 * A state the contract accepts, written by hand so the look-up is the only
 * thing under test. `ticketRef` is left off entirely for a work order named
 * from words alone, which is what a repository with no tracker writes.
 */
const workOrderStateOf = ({ name, ticketRef }: { name: string; ticketRef?: string }) => ({
	schemaVersion: 1,
	name,
	branch: name,
	...(ticketRef === undefined ? {} : { ticketRef }),
	mode: 'multiple-plan',
	plans: [],
	history: [],
});

/**
 * A checkout with no repository above it, holding one work order folder per
 * record: one carrying the tracker's own spelling of a reference, and one
 * carrying no reference at all.
 */
const setupCheckout = ({ records }: { records: { name: string; ticketRef?: string }[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-find-work-order-'));

	for (const { name, ticketRef } of records) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, ticketRef })));
	}

	return { cwd };
};

describe('findWorkOrderByTicketRef', () => {
	test('findWorkOrderByTicketRef: matches a reference whatever its case, and answers undefined when no record carries it', async () => {
		const { cwd } = setupCheckout({
			records: [{ name: 'lo-158-give-the-name-one', ticketRef: 'LO-158' }, { name: 'add-search-basics' }],
		});

		const matched = await findWorkOrderByTicketRef({ cwd, ticketRef: 'lo-158' });
		const unmatched = await findWorkOrderByTicketRef({ cwd, ticketRef: 'lo-999' });

		expect({ matched, unmatched }).toEqual({
			matched: {
				name: 'lo-158-give-the-name-one',
				record: expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'lo-158-give-the-name-one', ticketRef: 'LO-158' }),
			},
			unmatched: undefined,
		});
	});
});
