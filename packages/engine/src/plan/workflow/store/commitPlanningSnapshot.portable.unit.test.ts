import { describe, expect, test } from '@jest/globals';

// Dependencies
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningPortableFixture as setup } from '#tests/helpers/planningPortableFixture.ts';

describe('commitPlanningSnapshot', () => {
	test('cannot introduce a new omission through an ordinary successor commit', async () => {
		const fixture = await setup();
		const restored = await fixture.restore();
		const before = restored.snapshot;
		const artifacts = new Map(before.artifacts);
		artifacts.delete('custom-data.json');

		const commit = commitPlanningSnapshot({
			...restored,
			expectedRevision: before.record.revision,
			parentDigest: before.digest,
			record: { ...before.record, revision: before.record.revision + 1, parentDigest: before.digest },
			artifacts,
		});

		await expect(commit).rejects.toThrow('does not match its descriptor');
		expect((await readPlanningSnapshot(restored))?.digest).toBe(before.digest);
	});
});
