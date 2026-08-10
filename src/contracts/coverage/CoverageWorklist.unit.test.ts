import { describe, expect, test } from '@jest/globals';
import { CoverageWorklist } from '@/contracts';

const worklist = {
	at: '2026-01-01T00:00:00.000Z',
	totals: [
		{ scope: 'api', statementsPct: 71.5, passed: false },
		{ scope: 'web', statementsPct: 96, passed: true },
	],
	files: [
		{ path: 'packages/api/src/a.ts', scope: 'api', statementsPct: 12 },
		{ path: 'packages/web/src/b.ts', scope: 'web', statementsPct: 88 },
	],
};

describe('CoverageWorklist', () => {
	test('parses a measurement spanning two scopes, keeping each file attributed to its own', () => {
		const parsed = CoverageWorklist.parse(worklist);

		// package attribution is what lets a batch stay inside one scope
		expect(parsed.files[0]?.scope).toBe('api');
		// a green scope rides along in the totals so the final report can show it
		expect(parsed.totals[1]?.passed).toBe(true);
	});

	test('a worklist with no files list is refused, because the before side of the report would be missing', () => {
		const { files, ...withoutFiles } = worklist;

		expect(files.length).toBe(2);
		expect(CoverageWorklist.safeParse(withoutFiles).success).toBe(false);
	});

	test('a non-numeric statements percentage is refused rather than ordering the work-list by a string', () => {
		expect(CoverageWorklist.safeParse({ ...worklist, files: [{ path: 'src/a.ts', scope: 'root', statementsPct: 'Unknown' }] }).success).toBe(false);
		// the same rule applies to a scope total
		expect(CoverageWorklist.safeParse({ ...worklist, totals: [{ scope: 'root', statementsPct: null, passed: false }] }).success).toBe(false);
	});

	test('a work-list with no timestamp and one with no totals are both refused', () => {
		const { at, ...withoutAt } = worklist;
		const { totals, ...withoutTotals } = worklist;

		// at dates the frozen measurement the final report compares against, and
		// totals is its per-scope before side — neither may be inferred from an
		// absent key on a resume
		expect(at).toBe('2026-01-01T00:00:00.000Z');
		expect(totals.length).toBe(2);
		expect(CoverageWorklist.safeParse(withoutAt).success).toBe(false);
		expect(CoverageWorklist.safeParse(withoutTotals).success).toBe(false);
	});

	test('a numeric timestamp is refused rather than coerced, so the persisted file round-trips unchanged', () => {
		expect(CoverageWorklist.safeParse({ ...worklist, at: 1767225600000 }).success).toBe(false);
	});

	test('a file with no path is refused, because a batch report names the files it improved', () => {
		expect(CoverageWorklist.safeParse({ ...worklist, files: [{ scope: 'root', statementsPct: 12 }] }).success).toBe(false);
		// a path that is not a string is refused too rather than coerced into a name
		expect(CoverageWorklist.safeParse({ ...worklist, files: [{ path: 12, scope: 'root', statementsPct: 12 }] }).success).toBe(false);
	});

	test('a file with no scope is refused, because every batch is scoped to one package', () => {
		expect(CoverageWorklist.safeParse({ ...worklist, files: [{ path: 'src/a.ts', statementsPct: 12 }] }).success).toBe(false);
		// and a scope total without its own scope name is refused for the same reason
		expect(CoverageWorklist.safeParse({ ...worklist, totals: [{ statementsPct: 71.5, passed: false }] }).success).toBe(false);
	});

	test('a scope total with no pass signal is refused, because batching reads it to skip green scopes', () => {
		expect(CoverageWorklist.safeParse({ ...worklist, totals: [{ scope: 'api', statementsPct: 71.5 }] }).success).toBe(false);
	});

	test('the pass signal is refused in every form other than a boolean', () => {
		for (const passed of ['false', 'true', 0, 1, null]) {
			// a coerced flag would send a batch to a scope whose gate is already green,
			// or leave a red scope unworked
			expect(CoverageWorklist.safeParse({ ...worklist, totals: [{ scope: 'api', statementsPct: 71.5, passed }] }).success).toBe(false);
		}
	});

	test('a work-list with no scopes and no files parses — a repo already at the threshold still froze a measurement', () => {
		const parsed = CoverageWorklist.parse({ at: '2026-01-01T00:00:00.000Z', totals: [], files: [] });

		// an empty measurement is a work-list with nothing to do, not a missing file
		expect(parsed).toStrictEqual({ at: '2026-01-01T00:00:00.000Z', totals: [], files: [] });
	});

	test('files keep the worst-first order the measurement froze them in', () => {
		const parsed = CoverageWorklist.parse({
			...worklist,
			files: [
				{ path: 'packages/api/src/a.ts', scope: 'api', statementsPct: 12 },
				{ path: 'packages/api/src/c.ts', scope: 'api', statementsPct: 12 },
				{ path: 'packages/web/src/b.ts', scope: 'web', statementsPct: 88 },
			],
		});

		// the ordering is positional — the first entry is the worst-covered file, and
		// ties are already broken by path when the file is written
		expect(parsed.files.map((file) => file.path)).toStrictEqual(['packages/api/src/a.ts', 'packages/api/src/c.ts', 'packages/web/src/b.ts']);
	});

	test('keys the contract does not declare are stripped from the work-list, its totals, and its files', () => {
		const parsed = CoverageWorklist.parse({
			...worklist,
			runId: 'run-1',
			totals: [{ scope: 'api', statementsPct: 71.5, passed: false, branchesPct: 40 }],
			files: [{ path: 'packages/api/src/a.ts', scope: 'api', statementsPct: 12, functionsPct: 30 }],
		});

		// the summary report carries other metrics, but statements percentage is the
		// engine's whole ordering contract — nothing else reaches the frozen file
		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			totals: [{ scope: 'api', statementsPct: 71.5, passed: false }],
			files: [{ path: 'packages/api/src/a.ts', scope: 'api', statementsPct: 12 }],
		});
	});

	test('a totals value that is not an array is refused', () => {
		// a single scope object in place of the list is a malformed measurement
		expect(CoverageWorklist.safeParse({ ...worklist, totals: worklist.totals[0] }).success).toBe(false);
		expect(CoverageWorklist.safeParse({ ...worklist, files: worklist.files[0] }).success).toBe(false);
	});
});
