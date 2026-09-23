import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkOrderState } from '#src/contracts/index.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/index.ts';

interface Params {
	/** The record to write, whose `branch` names the ticket folder it lands in. */
	record: WorkOrderState;
}

/**
 * The bytes the record store itself writes for a record, taken from the store in
 * a throwaway checkout rather than restated in a fixture.
 *
 * A sidecar hash or a published copy a test plants has to be the exact byte form
 * a real machine would have recorded, and the store owns that spelling —
 * key order, indentation and trailing newline alike.
 */
export const canonicalTicketRecordText = async ({ record }: Params): Promise<string> => {
	const scratch = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-bytes-'));

	await updateLocalWorkOrderState({ cwd: scratch, name: record.branch, change: () => record });

	return readFileSync(join(scratch, '.lightsout', 'work-orders', record.branch, 'state.json'), 'utf8');
};
