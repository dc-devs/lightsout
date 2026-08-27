import { describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { DemoRunSlug } from '#src/lightsout/common/constants/DemoRunSlug.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';

// The committed fixtures themselves are the subject here: parsing them against
// the engine's own contract is what catches one gone stale after a contract
// change, at test time rather than in a reader's browser.

describe('getDemoRunViews', () => {
	test('parses all three committed runs against the contract the engine assembles them to', () => {
		const views = getDemoRunViews();

		expect(Object.keys(views).sort()).toStrictEqual([DemoRunSlug.Implement, DemoRunSlug.Refactor, DemoRunSlug.Stopped]);
	});

	test('fills each slot with the kind of run that slot exists to show', () => {
		const views = getDemoRunViews();

		expect({
			implement: views[DemoRunSlug.Implement].listing.status,
			refactor: views[DemoRunSlug.Refactor].listing.pipeline,
			stoppedIsStopped: views[DemoRunSlug.Stopped].listing.status !== RunStatus.Passed,
		}).toStrictEqual({ implement: RunStatus.Passed, refactor: 'refactor', stoppedIsStopped: true });
	});

	test('shows a burn-down in the refactor slot rather than a single job', () => {
		const views = getDemoRunViews();

		expect(views[DemoRunSlug.Refactor].steps.length).toBeGreaterThan(2);
	});

	test('parses once and hands the same object back, since the file cannot change while the app runs', () => {
		expect(getDemoRunViews()).toBe(getDemoRunViews());
	});
});
