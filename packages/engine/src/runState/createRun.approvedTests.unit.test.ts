import { describe, expect, test } from '@jest/globals';
import { createRun } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setupRepo = () => {
	const cwd = setupConsumerRepo({ git: false });

	return { cwd };
};

describe('createRun', () => {
	test('createRun: opens the acceptance mapping and the approved test records empty before any step runs', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// asserted on the return value, not a read-back — both fields default to
		// an empty array in the schema, so a read-back would pass on a missing write
		expect(manifest.acceptanceTests).toStrictEqual([]);
		expect(manifest.approvedTests).toStrictEqual([]);
	});
});
