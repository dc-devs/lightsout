import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RefactorWorklist } from '@/contracts';

const setupWorklist = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const batch = {
		id: 'batch-01:clone:src/scan',
		detector: 'clone',
		folder: 'src/scan',
		findings: [
			{
				detector: 'clone',
				severity: 'finding',
				cluster: 'clone:src/scan/runScan.ts:12',
				files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
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

		assert.deepEqual(parsed, {
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

			assert.equal(result.success, false, `${field} is required — the work-list is written once and re-read on every resume, so no field may be inferred from an absent key`);
		}
	});

	test('a scoped run records its subpath rather than the whole-repo sentinel', () => {
		const { worklist } = setupWorklist({ extra: { path: 'src/scan' } });

		const parsed = RefactorWorklist.parse(worklist);

		assert.equal(parsed.path, 'src/scan', 'the persisted scope is what a resumed run re-scans against — it is read back, not recomputed from flags');
	});

	test('all records burn-down mode as a boolean on both sides', () => {
		for (const all of [true, false]) {
			const { worklist } = setupWorklist({ extra: { all } });

			const parsed = RefactorWorklist.parse(worklist);

			assert.equal(parsed.all, all, `all=${all} is the difference between including baselined findings and working only what is new — a resume must read the flag the run started with`);
		}
	});

	test('rejects a truthy string or number in place of the all flag', () => {
		for (const all of ['true', 1, null]) {
			const { worklist } = setupWorklist({ extra: { all } });

			const result = RefactorWorklist.safeParse(worklist);

			assert.equal(result.success, false, 'a coerced flag would silently switch burn-down mode on a resume');
		}
	});

	test('rejects a non-string at rather than coercing a timestamp', () => {
		const { worklist } = setupWorklist({ extra: { at: 1780531200000 } });

		const result = RefactorWorklist.safeParse(worklist);

		assert.equal(result.success, false, 'at is the ISO string the run wrote, so the persisted JSON round-trips unchanged');
	});

	test('an empty batches array parses — a tree with no findings is still a work-list', () => {
		const { worklist } = setupWorklist({ extra: { batches: [] } });

		const parsed = RefactorWorklist.parse(worklist);

		assert.deepEqual(parsed.batches, [], 'a clean scan produces a work-list with nothing to do, not a missing file');
	});

	test('several batches keep the order the work-list froze them in', () => {
		const { worklist, batch } = setupWorklist();
		const second = { ...batch, id: 'batch-02:structure:src/cli', detector: 'structure', folder: 'src/cli' };

		const parsed = RefactorWorklist.parse({ ...worklist, batches: [batch, second] });

		assert.deepEqual(
			parsed.batches.map((entry) => entry.id),
			['batch-01:clone:src/scan', 'batch-02:structure:src/cli'],
			'the numbered step ids are positional — a resume walks the list as persisted',
		);
	});

	test('one malformed batch rejects the whole work-list', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: [batch, { id: 'batch-02:size:src/cli', detector: 'size' }] });

		assert.equal(result.success, false, 'a partly readable work-list is refused at the read boundary rather than resuming into a run that would skip the unreadable batches');
	});

	test('a batch carrying a malformed finding rejects the work-list through the nesting', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: [{ ...batch, findings: [{ ...batch.findings[0], severity: 'warning' }] }] });

		assert.equal(result.success, false, 'validation reaches all the way down — the cluster ids the post-batch re-scan checks come from these findings');
	});

	test('rejects a batches value that is not an array', () => {
		const { worklist, batch } = setupWorklist();

		const result = RefactorWorklist.safeParse({ ...worklist, batches: batch });

		assert.equal(result.success, false, 'a single batch object in place of the list is a malformed work-list');
	});

	test('keys the contract does not declare are stripped from the work-list and from its batches', () => {
		const { worklist, batch } = setupWorklist();

		const parsed = RefactorWorklist.parse({ ...worklist, runId: 'run-1', batches: [{ ...batch, attempts: 2 }] });

		assert.deepEqual(
			parsed,
			{
				at: '2026-08-04T00:00:00.000Z',
				path: '.',
				all: false,
				batches: [batch],
			},
			'the persisted plan holds the fields the contract declares — run identity and step progress live in the manifest, never duplicated onto the frozen work-list',
		);
	});
});
