import { describe, expect, test } from '@jest/globals';
import { StandardsSnapshot } from '#src/contracts/index.ts';

const setupSnapshot = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const snapshot: Record<string, unknown> = {
		at: '2026-08-19T10:15:30.123Z',
		path: '.',
		findings: [
			{
				rule: 'clone',
				severity: 'blocking',
				siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
				files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
				detail: 'a 36-line span repeated across two files',
			},
		],
		notes: ['3 rules were switched off by this repo'],
		...extra,
	};

	if (omit) {
		delete snapshot[omit];
	}

	return { snapshot };
};

const setupScrambledSnapshot = () => {
	// deliberately written in the reverse of the declared order, so the assertion
	// proves the schema imposes the order rather than echoing whatever it was handed
	const snapshot = {
		notes: ['3 rules were switched off by this repo'],
		findings: [],
		path: '.',
		at: '2026-08-19T10:15:30.123Z',
	};

	return { snapshot };
};

describe('StandardsSnapshot', () => {
	test('a written snapshot round-trips with its findings and notes intact', () => {
		const { snapshot } = setupSnapshot();

		const parsed = StandardsSnapshot.parse(snapshot);

		expect(parsed).toStrictEqual({
			at: '2026-08-19T10:15:30.123Z',
			path: '.',
			findings: [
				{
					rule: 'clone',
					severity: 'blocking',
					siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
					files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
					detail: 'a 36-line span repeated across two files',
				},
			],
			notes: ['3 rules were switched off by this repo'],
		});
	});

	test('a clean check parses with no findings and no notes', () => {
		const { snapshot } = setupSnapshot({ extra: { findings: [], notes: [] } });

		const parsed = StandardsSnapshot.parse(snapshot);

		// a repo with nothing to fix still writes a snapshot — it is the point the
		// trend plots as zero, not an absence
		expect(parsed).toStrictEqual({ at: '2026-08-19T10:15:30.123Z', path: '.', findings: [], notes: [] });
	});

	test('a subpath check records the subpath it covered', () => {
		const { snapshot } = setupSnapshot({ extra: { path: 'packages/engine/src/standardsCheck' } });

		const parsed = StandardsSnapshot.parse(snapshot);

		// the trend point carries this through, so two snapshots of different
		// subpaths are never read as one repo-wide series
		expect(parsed.path).toBe('packages/engine/src/standardsCheck');
	});

	test('several findings keep their order and every field of each', () => {
		const { snapshot } = setupSnapshot({
			extra: {
				findings: [
					{
						rule: 'size-function',
						severity: 'blocking',
						siteKey: 'size-function:src/refactor/runBatch.ts:90',
						files: [{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 190 }],
						detail: 'a 100-line function',
					},
					{
						rule: 'dead-export',
						severity: 'advisory',
						siteKey: 'dead-export:src/refactor/oldHelper.ts',
						files: [{ path: 'src/refactor/oldHelper.ts' }],
						detail: 'exported and never imported',
						guidance: 'Delete the export or give it a consumer.',
					},
				],
			},
		});

		const parsed = StandardsSnapshot.parse(snapshot);

		// the refactor pipeline reads this array as its work-list and batches it in
		// file order — a reordered or thinned finding would rebatch the burn-down
		expect(parsed.findings).toStrictEqual([
			{
				rule: 'size-function',
				severity: 'blocking',
				siteKey: 'size-function:src/refactor/runBatch.ts:90',
				files: [{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 190 }],
				detail: 'a 100-line function',
			},
			{
				rule: 'dead-export',
				severity: 'advisory',
				siteKey: 'dead-export:src/refactor/oldHelper.ts',
				files: [{ path: 'src/refactor/oldHelper.ts' }],
				detail: 'exported and never imported',
				guidance: 'Delete the export or give it a consumer.',
			},
		]);
	});

	test('several notes come back in order', () => {
		const { snapshot } = setupSnapshot({ extra: { notes: ['1 rule was switched off', 'the agent review was skipped'] } });

		const parsed = StandardsSnapshot.parse(snapshot);

		// notes are printed verbatim under the report — they explain what the run did
		// NOT check, so a dropped one reads as a clean check that never happened
		expect(parsed.notes).toStrictEqual(['1 rule was switched off', 'the agent review was skipped']);
	});

	test.each([{ field: 'at' }, { field: 'path' }, { field: 'findings' }, { field: 'notes' }])('rejects a snapshot with no $field', ({ field }) => {
		const { snapshot } = setupSnapshot({ omit: field });

		const result = StandardsSnapshot.safeParse(snapshot);

		expect(result.success).toBe(false);
	});

	test.each([
		{ label: 'a timestamp given as epoch milliseconds', extra: { at: 1_755_600_930_123 } },
		{ label: 'a timestamp given as a Date', extra: { at: new Date('2026-08-19T10:15:30.123Z') } },
		{ label: 'a path given as a number', extra: { path: 42 } },
	])('rejects $label rather than coercing it', ({ extra }) => {
		const { snapshot } = setupSnapshot({ extra });

		const result = StandardsSnapshot.safeParse(snapshot);

		// `at` is the string the dated filename is derived from and `path` is joined
		// into a report line — neither survives a silent type change
		expect(result.success).toBe(false);
	});

	test.each([
		{ label: 'findings given as a single object', extra: { findings: { rule: 'clone' } } },
		{ label: 'findings given as null', extra: { findings: null } },
		{ label: 'notes given as one string', extra: { notes: 'a single note' } },
		{ label: 'notes holding a non-string entry', extra: { notes: ['a note', 42] } },
	])('rejects $label', ({ extra }) => {
		const { snapshot } = setupSnapshot({ extra });

		const result = StandardsSnapshot.safeParse(snapshot);

		// both fields are iterated unconditionally by every reader; a scalar in place
		// of the list throws at the first render rather than at the boundary
		expect(result.success).toBe(false);
	});

	test('one malformed finding rejects the whole snapshot', () => {
		const { snapshot } = setupSnapshot({
			extra: {
				findings: [
					{
						rule: 'clone',
						severity: 'blocking',
						siteKey: 'clone:src/a.ts:1',
						files: [{ path: 'src/a.ts' }],
						detail: 'a repeated span',
					},
					{ rule: 'size-file', severity: 'off', siteKey: 'size-file:src/b.ts', files: [{ path: 'src/b.ts' }], detail: 'too long' },
				],
			},
		});

		const result = StandardsSnapshot.safeParse(snapshot);

		// `off` is a configuration state, never a persisted severity — the snapshot
		// validates its findings rather than passing an unreadable one through to the
		// work-list
		expect(result.success).toBe(false);
	});

	test('keys the contract does not declare are stripped from the snapshot', () => {
		const { snapshot } = setupSnapshot({ extra: { findings: [], notes: [], version: 2, durationMs: 4100 } });

		const parsed = StandardsSnapshot.parse(snapshot);

		// a snapshot written by a later engine still reads here as the four fields
		// this one knows, so an added field can never change the bytes a reader sees
		expect(parsed).toStrictEqual({ at: '2026-08-19T10:15:30.123Z', path: '.', findings: [], notes: [] });
	});

	test('a parsed snapshot carries its keys in the declared order, whatever order it was given in', () => {
		const { snapshot } = setupScrambledSnapshot();

		const parsed = StandardsSnapshot.parse(snapshot);

		// the order is load-bearing: a snapshot read here is re-serialized into
		// `.lightsout/standards-check.json`, which the refactor pipeline reads as its
		// work-list and people read in diffs. Reordering the keys would show up as a
		// whole-file diff in every consumer repo for no change a reader could explain
		expect(Object.keys(parsed)).toStrictEqual(['at', 'path', 'findings', 'notes']);
	});
});
