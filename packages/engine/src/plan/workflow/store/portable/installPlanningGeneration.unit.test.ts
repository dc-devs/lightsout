import { describe, expect, test } from '@jest/globals';

// Dependencies
import { planningPortableFixture as setup } from '#tests/helpers/planningPortableFixture.ts';

describe('installPlanningGeneration', () => {
	test('preserves original generation and accepted proof history while excluding local source bytes', async () => {
		const fixture = await setup({ complete: true });

		const restored = await fixture.restore();

		expect(restored.snapshot.digest).toBe(fixture.snapshot.digest);
		expect(restored.snapshot.record).toEqual(fixture.snapshot.record);
		expect(restored.snapshot.record.revision).toBeGreaterThan(0);
		expect(restored.snapshot.record.reviewReceipts.length).toBeGreaterThan(0);
		expect(restored.snapshot.artifacts.has(fixture.observationPath)).toBe(false);
		expect(restored.snapshot.artifacts.get('custom-data.json')).toContain('core contract metadata');
		expect(fixture.text).not.toContain('export const privateSource');
		expect(restored.snapshot.omittedObservations).toEqual([
			expect.objectContaining({ path: fixture.observationPath, observation: expect.objectContaining({ request: fixture.observation.request }) }),
		]);
	});
});
