import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { activityRecordPath } from '#src/activity/activityRecordPath.ts';

/**
 * A plan folder that was never created — the case a reader presents when it asks
 * about a plan that predates the activity record, or one that recorded nothing.
 * The temp root above it is real, so the only reason the folder can be missing
 * after the act is that asking for a path created nothing.
 */
const setupUnrecordedPlanFolder = () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-activity-path-'));
	const dir = join(root, 'lo-150-planning-observability');

	return { dir };
};

describe('activityRecordPath', () => {
	// the file name is spelled out here rather than imported from the module, so
	// a record that quietly renamed itself fails this test instead of agreeing
	// with it
	test('the record path is activity.jsonl inside the given directory', () => {
		const { dir } = setupUnrecordedPlanFolder();

		const path = activityRecordPath({ dir });

		expect(path).toBe(join(dir, 'activity.jsonl'));
		expect(existsSync(dir)).toBe(false);
	});
});
