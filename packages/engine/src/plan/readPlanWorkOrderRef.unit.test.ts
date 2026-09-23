import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readPlanWorkOrderRef } from '#src/plan/readPlanWorkOrderRef.ts';

/**
 * A state the contract accepts, written by hand so the record read is the only
 * thing under test. `ticketRef` is stated apart from `name`, because the label
 * a work order was given never has to spell the ticket it belongs to.
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
 * A checkout with no repository above it, holding one work-order folder per
 * record: one whose ticket reference its label does not spell, and one that
 * belongs to no ticket at all.
 */
const setupCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-read-plan-work-order-ref-'));

	for (const { name, ticketRef } of [
		{ name: 'rate-limit-banner', ticketRef: 'LO-412' },
		{ name: 'phase-2-cleanup', ticketRef: undefined },
	]) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, ticketRef })));
	}

	return { cwd };
};

describe('readPlanWorkOrderRef', () => {
	test("answers the record's ticket reference rather than reading one out of the label", async () => {
		const { cwd } = setupCheckout();

		const named = await readPlanWorkOrderRef({ cwd, name: 'rate-limit-banner/001-throttle' });
		const unnamed = await readPlanWorkOrderRef({ cwd, name: 'phase-2-cleanup/001-tidy' });

		expect({ named, unnamed }).toEqual({ named: 'LO-412', unnamed: undefined });
	});
});
