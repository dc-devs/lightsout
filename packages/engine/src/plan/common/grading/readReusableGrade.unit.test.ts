import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readReusableGrade } from '#src/plan/common/grading/readReusableGrade.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// Whether the verdict already on disk really is the passing full review a later
// pass may report as current rather than pay for again.

/** The combined fingerprint the pass under test measured — the one value a reuse compares. */
const currentFingerprint = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/** What that pass measured, as a grade report records it. */
const inputs = {
	planFiles: [{ file: 'plan.md', sha256: 'plan-text-hash' }],
	gradedCommit: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
	changedFiles: [],
	config: 'config-hash',
	prompts: 'prompts-hash',
	sha256: currentFingerprint,
};

/** A complete, passing, full-scope verdict fingerprinted against those very inputs — every condition the reuse demands, met. */
const passingFullReview = {
	planName: 'plan-regrading',
	grade: 'A',
	structural: [],
	gaps: [],
	phasesChecked: ['plan.md'],
	lenses: ['surface', 'wiring', 'decisions'],
	complete: true,
	passed: true,
	gradedAt: '2026-09-07T00:00:00.000Z',
	scope: 'full',
	focusedOn: [],
	inputs,
};

/**
 * A plan folder holding one `grade.json`, written verbatim so a test can put
 * text there that is not a report at all. `text: undefined` leaves the folder
 * empty, which is the plan that has never been graded.
 */
const setupRecordedGrade = async ({ text }: { text?: string } = {}) => {
	const cwd = await freshCwd();
	const gradePath = join(cwd, 'grade.json');

	if (text !== undefined) {
		await writeFile(gradePath, text, 'utf8');
	}

	return { gradePath };
};

describe('readReusableGrade', () => {
	test('the recorded passing full review is returned when it was measured against these very inputs', async () => {
		const { gradePath } = await setupRecordedGrade({ text: JSON.stringify(passingFullReview) });

		const reusable = await readReusableGrade({ gradePath, sha256: currentFingerprint });

		// this is the one verdict a later pass may report as current: it passed, it
		// finished, it read the whole plan, and the plan and the code beside it have
		// not moved since
		expect(reusable).toEqual(expect.objectContaining({ planName: 'plan-regrading', grade: 'A', passed: true, complete: true, scope: 'full' }));
		expect(reusable?.inputs?.sha256).toBe(currentFingerprint);
	});

	test.each<{ why: string; overrides: Record<string, unknown> }>([
		{ why: 'it did not pass', overrides: { grade: 'below-A', passed: false } },
		{ why: 'a reader was lost, so it never read every phase', overrides: { complete: false } },
		{ why: 'it was a focused repair check, which can never approve', overrides: { scope: 'focused', focusedOn: ['phase2-extra.md'] } },
		{ why: 'the inputs it measured have since moved', overrides: { inputs: { ...inputs, sha256: 'some-other-combined-hash' } } },
		{ why: 'it predates the fingerprint and cannot say what it measured', overrides: { inputs: undefined } },
	])('a verdict that is not a passing full review of these inputs is not reused — $why', async ({ overrides }) => {
		const { gradePath } = await setupRecordedGrade({ text: JSON.stringify({ ...passingFullReview, ...overrides }) });

		const reusable = await readReusableGrade({ gradePath, sha256: currentFingerprint });

		// the memory cannot vouch for the file beside it, so the verdict has to say
		// for itself that it is the review being reused
		expect(reusable).toBe(undefined);
	});

	test.each<{ why: string; text: string | undefined }>([
		{ why: 'the plan has never been graded', text: undefined },
		{ why: 'the file is not JSON', text: 'stopped before any agent was spawned' },
		{ why: 'the JSON is not a grade report', text: '{ "planName": 5 }' },
	])('a grade.json that cannot be read as a verdict is not reused — $why', async ({ text }) => {
		const { gradePath } = await setupRecordedGrade({ text });

		const reusable = await readReusableGrade({ gradePath, sha256: currentFingerprint });

		// a file that says nothing readable is not the review being reused; the
		// caller pays for a pass that runs rather than trusting it
		expect(reusable).toBe(undefined);
	});
});
