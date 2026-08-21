import { describe, expect, test } from '@jest/globals';
import { type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { readStandingWork } from '#src/refactor/batch/readStandingWork.ts';

const finding = ({ path, detail = 'a site' }: { path: string; detail?: string }): StandardsFinding => ({
	rule: 'multi-export',
	severity: StandardsSeverity.Blocking,
	siteKey: `multi-export:${path}`,
	files: [{ path }],
	detail,
});

const setupBatch = ({ paths }: { paths: string[] }): RefactorBatch => ({
	id: 'batch-02',
	rule: 'multi-export',
	folder: 'src',
	blocking: paths.map((path) => finding({ path })),
	advisories: [],
});

describe('readStandingWork', () => {
	test('returns the live finding for a site, not the frozen copy that named it', () => {
		const batch = setupBatch({ paths: ['src/a.ts'] });
		const live = finding({ path: 'src/a.ts', detail: '3 exports (alpha, beta, gamma)' });

		const standing = readStandingWork({ batch, findings: [live], onProgress: () => undefined });

		// the frozen copy said 'a site'; what the agent is shown is what is true now
		expect(standing).toStrictEqual([live]);
	});

	test('drops a site earlier work already fixed, and says how many it dropped', () => {
		const batch = setupBatch({ paths: ['src/a.ts', 'src/b.ts'] });
		const messages: string[] = [];

		const standing = readStandingWork({ batch, findings: [finding({ path: 'src/b.ts' })], onProgress: (message) => messages.push(message) });

		expect(standing.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/b.ts']);
		expect(messages).toStrictEqual(['batch-02: 1 of 2 site(s) already resolved by earlier work — working the 1 still standing']);
	});

	test('says nothing when every site is still standing — there is no discrepancy to explain', () => {
		const batch = setupBatch({ paths: ['src/a.ts'] });
		const messages: string[] = [];

		readStandingWork({ batch, findings: [finding({ path: 'src/a.ts' })], onProgress: (message) => messages.push(message) });

		expect(messages).toStrictEqual([]);
	});

	test('an empty result is left for the caller to announce — that batch is resolved, not partly worked', () => {
		const batch = setupBatch({ paths: ['src/a.ts'] });
		const messages: string[] = [];

		const standing = readStandingWork({ batch, findings: [], onProgress: (message) => messages.push(message) });

		expect(standing).toStrictEqual([]);
		expect(messages).toStrictEqual([]);
	});

	test('a live finding for some other batch is not this batch’s work', () => {
		const batch = setupBatch({ paths: ['src/a.ts'] });

		const standing = readStandingWork({ batch, findings: [finding({ path: 'src/a.ts' }), finding({ path: 'other/z.ts' })], onProgress: () => undefined });

		expect(standing.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/a.ts']);
	});
});
