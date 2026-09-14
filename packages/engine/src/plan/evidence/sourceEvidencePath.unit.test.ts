import { join, resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { sourceEvidencePath } from '#src/plan/evidence/sourceEvidencePath.ts';

/** A repo root the cases resolve against — nothing is read from disk, so it need not exist. */
const cwd = resolve('/repo');

test("sourceEvidencePath: the evidence record sits inside the plan's own workspace folder", () => {
	const forOnePlan = sourceEvidencePath({ cwd, name: 'lo-142-focused-drafting' });
	const forAnother = sourceEvidencePath({ cwd, name: 'rate-limit-banner' });

	// spelled out segment by segment rather than built from the helper under
	// test, so a record that moved out of the plan folder — or into a shared
	// one every plan would overwrite — fails here instead of agreeing with itself
	expect(forOnePlan).toBe(join(cwd, '.lightsout', 'plans', 'lo-142-focused-drafting', 'source-evidence.json'));
	expect(forAnother).toBe(join(cwd, '.lightsout', 'plans', 'rate-limit-banner', 'source-evidence.json'));
});
