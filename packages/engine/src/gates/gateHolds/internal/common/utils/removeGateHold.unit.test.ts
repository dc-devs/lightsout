import { describe, expect, test } from '@jest/globals';
import { readGateHolds } from '#src/gates/gateHolds/internal/common/utils/readGateHolds.ts';
import { removeGateHold } from '#src/gates/gateHolds/internal/common/utils/removeGateHold.ts';
import { buildGateHold } from '#tests/helpers/buildGateHold.ts';
import { setupGateHoldsFolder } from '#tests/helpers/setupGateHoldsFolder.ts';

describe('removeGateHold', () => {
	test('removes one hold, tolerates an absent one, and leaves the rest', async () => {
		const { cwd } = setupGateHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(buildGateHold({ runId: 'run-a' })),
				'lo-119.json': JSON.stringify(buildGateHold({ runId: 'run-b' })),
			},
		});

		await removeGateHold({ cwd, identifier: 'LO-118' });
		const removingAgain = removeGateHold({ cwd, identifier: 'LO-118' });

		// two drains can reconcile the same released hold at once, so the second
		// removal is an ordinary outcome and not a failure — and neither of them may
		// take another ticket's hold down with it
		await expect(removingAgain).resolves.toBeUndefined();
		const remaining = await readGateHolds({ cwd });

		expect(remaining).toStrictEqual({ 'lo-119': buildGateHold({ runId: 'run-b' }) });
	});
});
