import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { readWorkOrderStateFile } from '#src/workOrder/common/utils/readWorkOrderStateFile.ts';

const setupStateFile = async () => {
	const folder = await mkdtemp(join(tmpdir(), 'lightsout-work-order-state-'));

	/**
	 * One `state.json`, holding whatever label the record itself claims. Its
	 * branch always carries a prefix its name does not, because the two fields
	 * are written independently and only `name` says which folder the record
	 * belongs to.
	 */
	const plantState = async ({ claims }: { claims: string }) => {
		const state: WorkOrderState = {
			schemaVersion: 1,
			name: claims,
			branch: `feature/${claims}`,
			mode: WorkOrderMode.SinglePlan,
			plans: [],
			history: [],
		};
		const statePath = join(folder, `${claims}.json`);

		await writeFile(statePath, JSON.stringify(state), 'utf8');

		return { statePath, state };
	};

	return { plantState };
};

describe('readWorkOrderStateFile', () => {
	test('refuses a state file naming a different work order', async () => {
		const { plantState } = await setupStateFile();

		const stranger = await plantState({ claims: 'lo-2-another-work-order' });
		const own = await plantState({ claims: 'lo-1-record-is-identity' });
		const mismatched = await readWorkOrderStateFile({ statePath: stranger.statePath, name: 'lo-1-record-is-identity' });
		const matched = await readWorkOrderStateFile({ statePath: own.statePath, name: 'lo-1-record-is-identity' });

		// one sentence naming the label the record claims and the folder it was
		// read for, and no record at all: a record naming another work order must
		// never be handed back as this one's
		expect(mismatched).toEqual({ error: expect.stringMatching(/lo-2-another-work-order[\s\S]*lo-1-record-is-identity/) });
		// the matching record comes back whole, prefixed branch and all, because
		// the guard reads `name` — the folder's label — and never `branch`
		expect(matched).toStrictEqual({ record: own.state });
	});
});
