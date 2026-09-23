import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readWorkOrderRecordFile } from '#src/common/workspace/readWorkOrderRecordFile.ts';

/**
 * A record the contract accepts, written by hand so the read is the only thing
 * under test. `branch` and `ticketRef` are stated apart from `name`, because a
 * label never has to spell either of them.
 */
const workOrderStateOf = () => ({
	schemaVersion: 1,
	name: 'lo-2-beta',
	branch: 'feature/lo-2-beta',
	ticketRef: 'LO-2',
	mode: 'multiple-plan',
	plans: [],
	history: [],
});

/**
 * One work order folder, optionally holding a `state.json` with the given text.
 * With no text the folder exists and the record does not — the shape a folder
 * left behind by hand leaves.
 */
const setupWorkOrderFolder = ({ contents }: { contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-read-work-order-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', 'lo-2-beta');

	mkdirSync(workOrderFolder, { recursive: true });

	if (contents !== undefined) {
		writeFileSync(join(workOrderFolder, 'state.json'), contents);
	}

	return { workOrderFolder };
};

describe('readWorkOrderRecordFile', () => {
	test('answers the record the folder holds, with the branch and the ticket it stores', async () => {
		const { workOrderFolder } = setupWorkOrderFolder({ contents: JSON.stringify(workOrderStateOf()) });

		const record = await readWorkOrderRecordFile({ workOrderFolder });

		expect(record).toEqual(expect.objectContaining({ name: 'lo-2-beta', branch: 'feature/lo-2-beta', ticketRef: 'LO-2' }));
	});

	test('answers undefined for a folder that holds no record at all', async () => {
		const { workOrderFolder } = setupWorkOrderFolder();

		const record = await readWorkOrderRecordFile({ workOrderFolder });

		expect(record).toBeUndefined();
	});

	test('answers undefined for a record that is not JSON, rather than throwing across the seam', async () => {
		const { workOrderFolder } = setupWorkOrderFolder({ contents: '{ this is not json' });

		const record = await readWorkOrderRecordFile({ workOrderFolder });

		expect(record).toBeUndefined();
	});

	test('answers undefined for JSON the contract refuses, so a half-written record claims no branch', async () => {
		const { workOrderFolder } = setupWorkOrderFolder({ contents: JSON.stringify({ ...workOrderStateOf(), branch: '' }) });

		const record = await readWorkOrderRecordFile({ workOrderFolder });

		expect(record).toBeUndefined();
	});
});
