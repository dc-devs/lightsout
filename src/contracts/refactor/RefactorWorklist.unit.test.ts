import { expect, describe, test } from '@jest/globals';
import { RefactorWorklist } from '@/contracts';

const setupWorklist = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const batch = {
		id: 'batch-01:clone:src/standardsCheck',
		rule: 'clone',
		folder: 'src/standardsCheck',
		findings: [
			{
				rule: 'clone',
				severity: 'finding',
				siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
				files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
				detail: 'a 36-line span repeated across two files',
			},
		],
		advisories: [],
	};
	const worklist: Record<string, unknown> = {
		at: '2026-08-04T00:00:00.000Z',
		path: '.',
		all: false,
		batches: [batch],
		...extra,
	};

	if (omit) {
		delete worklist[omit];
	}

	return { worklist, batch };
};

describe('RefactorWorklist', () => {
	test('a frozen work-list parses with its batches intact', () => {
		const { worklist, batch } = setupWorklist();

		const parsed = RefactorWorklist.parse(worklist);

		expect(parsed).toStrictEqual({
			at: '2026-08-04T00:00:00.000Z',
			path: '.',
			all: false,
			batches: [batch],
		});
	});

	test('at, path, all, and batches are each required', () => {
		for (const field of ['at', 'path', 'all', 'batches']) {
			const { worklist } = setupWorklist({ omit: field });

			const result = RefactorWorklist.safeParse(worklist);

			// ${field} is required — the work-list is written once and re-read on every
			// resume, so no field may be inferred from an absent key
			expect(result.success).toBe(false);
		}
	});

	test('a scoped run records its subpath rather than the whole-repo sentinel', () => {
		const { worklist } = setupWorklist({ extra: { path: 'src/standardsCheck' } });

		const parsed = RefactorWorklist.parse(worklist);

		// the persisted scope is what a resumed run re-checks against — it is read
		// back, not recomputed from flags
		expect(parsed.path).toBe('src/standardsCheck');
	});

	test('all records burn-down mode as a boolean on both sides', () => {
		for (const all of [true, false]) {
			const { worklist } = setupWorklist({ extra: { all } });

			const parsed = RefactorWorklist.parse(worklist);

			// all=${all} is the difference between including baselined findings and
			// working only what is new — a resume must read the flag the run started with
			expect(parsed.all).toBe(all);
		}
	});

	test('rejects a truthy string or number in place of the all flag', () => {
		for (const all of ['true', 1, null]) {
			const { worklist } = setupWorklist({ extra: { all } });

			const result = RefactorWorklist.safeParse(worklist);

			// a coerced flag would silently switch burn-down mode on a resume
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-string at rather than coercing a timestamp', () => {
		const { worklist } = setupWorklist({ extra: { at: 1780531200000 } });

		const result = RefactorWorklist.safeParse(worklist);

		// at is the ISO string the run wrote, so the persisted JSON round-trips
		// unchanged
		expect(result.success).toBe(false);
	});

	test('an empty batches array parses — a tree with no findings is still a work-list', () => {
		const { worklist } = setupWorklist({ extra: { batches: [] } });

		const parsed = RefactorWorklist.parse(worklist);

		// a clean check produces a work-list with nothing to do, not a missing file
		expect(parsed.batches).toStrictEqual([]);
	});

	test('several batches keep the order the work-list froze them in', () => {
		const { worklist, batch } = setupWorklist();
		const second = { ...batch, id: 'batch-02:structure:src/cli', rule: 'structure', folder: 'src/cli' };

		const parsed = RefactorWorklist.parse({ ...worklist, batches: [batch, second] });

		// the numbered step ids are positional — a resume walks the list as persisted
		expect(parsed.batches.map((entry) => entry.id)).toStrictEqual(['batch-01:clone:src/standardsCheck', 'batch-02:structure:src/cli']);
	});

	test('one malformed batch rejects the whole work-list', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: [batch, { id: 'batch-02:size:src/cli', rule: 'size' }] });

		// a partly readable work-list is refused at the read boundary rather than
		// resuming into a run that would skip the unreadable batches
		expect(result.success).toBe(false);
	});

	test('a batch carrying a malformed finding rejects the work-list through the nesting', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: [{ ...batch, findings: [{ ...batch.findings[0], severity: 'warning' }] }] });

		// validation reaches all the way down — the site keys the post-batch re-check
		// looks for come from these findings
		expect(result.success).toBe(false);
	});

	test('rejects a batches value that is not an array', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: batch });

		// a single batch object in place of the list is a malformed work-list
		expect(result.success).toBe(false);
	});

	test('keys the contract does not declare are stripped from the work-list and from its batches', () => {
		const { worklist, batch } = setupWorklist();

		const parsed = RefactorWorklist.parse({ ...worklist, runId: 'run-1', batches: [{ ...batch, attempts: 2 }] });

		// the persisted plan holds the fields the contract declares — run identity and
		// step progress live in the manifest, never duplicated onto the frozen
		// work-list
		expect(parsed).toStrictEqual({
			at: '2026-08-04T00:00:00.000Z',
			path: '.',
			all: false,
			batches: [batch],
		});
	});
});
