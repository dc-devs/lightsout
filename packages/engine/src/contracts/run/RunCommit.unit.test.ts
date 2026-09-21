import { describe, expect, test } from '@jest/globals';
import { RunCommit } from '#src/contracts/index.ts';

/** One commit a run left behind: the sha git answered, the subject it was made under, and the run that made it. */
const setupEntry = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const entry: Record<string, unknown> = {
		sha: 'c0ffee1234567890c0ffee1234567890c0ffee12',
		subject: 'LO-150 001-planning-observability: Planning observability',
		runId: 'run-2026-09-20-abcdef',
		...extra,
	};

	if (omit) {
		delete entry[omit];
	}

	return { entry };
};

describe('RunCommit', () => {
	test('accepts a complete entry and refuses an unknown or missing field', () => {
		const { entry: complete } = setupEntry();
		const { entry: extraKey } = setupEntry({ extra: { author: 'someone' } });
		const { entry: noSha } = setupEntry({ omit: 'sha' });

		const parsed = RunCommit.parse(complete);

		// the three facts a result block needs to name what the run left behind
		expect(parsed).toStrictEqual({
			sha: 'c0ffee1234567890c0ffee1234567890c0ffee12',
			subject: 'LO-150 001-planning-observability: Planning observability',
			runId: 'run-2026-09-20-abcdef',
		});
		// a field a newer engine wrote must fail the parse rather than be
		// silently stripped and written back missing
		expect(RunCommit.safeParse(extraKey).success).toBe(false);
		// without the sha there is no commit to name, so nothing defaults in
		expect(RunCommit.safeParse(noSha).success).toBe(false);
	});
});
