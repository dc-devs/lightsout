import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { StandardsSeverity, type StandardsSnapshot } from '#src/contracts/index.ts';
import { listStandardsSnapshots, writeStandardsSnapshot } from '#src/standardsCheck/index.ts';

const snapshot = (overrides: Partial<StandardsSnapshot> = {}): StandardsSnapshot => ({
	at: '2026-08-19T12:30:45.123Z',
	path: '.',
	findings: [
		{
			rule: 'multi-export',
			severity: StandardsSeverity.Blocking,
			siteKey: 'multi-export:src/a/config.ts',
			files: [{ path: 'src/a/config.ts' }],
			detail: 'two exports',
		},
	],
	notes: ['1 file scanned'],
	...overrides,
});

const freshRepo = () => mkdtemp(join(tmpdir(), 'lightsout-trend-'));

test('a repo that has never run a check reads as an empty trend, not an error', async () => {
	const cwd = await freshRepo();

	// the standards view has to render on a fresh clone
	expect(await listStandardsSnapshots({ cwd })).toStrictEqual([]);
});

test('a snapshots directory holding nothing reads as an empty trend', async () => {
	const cwd = await freshRepo();

	mkdirSync(join(cwd, '.lightsout', 'standards-check'), { recursive: true });

	// an emptied history is not a missing one, and neither is an error
	expect(await listStandardsSnapshots({ cwd })).toStrictEqual([]);
});

test('the dated history stands even when the latest file will not read', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });
	// what a hand-edited work-list looks like from here — the latest file is the
	// one the refactor pipeline reads, so it is the one most likely to be touched
	writeFileSync(join(cwd, '.lightsout', 'standards-check.json'), '{ not json');

	// the dated copy written beside it still carries the trend, because the
	// history is kept in its own files rather than derived from the latest one
	expect((await listStandardsSnapshots({ cwd })).map((point) => point.at)).toStrictEqual(['2026-08-19T12:30:45.123Z']);
});

test('the trend reduces every dated snapshot to counts, oldest first, and skips one it cannot read', async () => {
	const cwd = await freshRepo();
	const advisory = {
		rule: 'size-function',
		severity: StandardsSeverity.Advisory,
		siteKey: 'size-function:src/b.ts',
		files: [{ path: 'src/b.ts' }],
		detail: '81 lines',
	};

	await writeStandardsSnapshot({ cwd, snapshot: snapshot({ at: '2026-08-20T09:00:00.000Z', findings: [...snapshot().findings, advisory] }) });
	await writeStandardsSnapshot({ cwd, snapshot: snapshot({ at: '2026-08-19T12:30:45.123Z', path: 'src' }) });
	await writeStandardsSnapshot({ cwd, snapshot: snapshot({ at: '2026-08-18T08:00:00.000Z', findings: [] }) });
	// one corrupt file must not take the whole trend down with it
	writeFileSync(join(cwd, '.lightsout', 'standards-check', 'broken.json'), '{ not json');
	// nor must anything that is not a snapshot at all
	writeFileSync(join(cwd, '.lightsout', 'standards-check', 'notes.txt'), 'ignored');

	const trend = await listStandardsSnapshots({ cwd });

	// oldest first, so a chart plots it without re-sorting
	expect(trend.map((point) => point.at)).toStrictEqual(['2026-08-18T08:00:00.000Z', '2026-08-19T12:30:45.123Z', '2026-08-20T09:00:00.000Z']);
	// each point carries the scope it covered, so a subfolder run is not read as a whole-repo one
	expect(trend.map((point) => point.path)).toStrictEqual(['.', 'src', '.']);
	// counts split by severity, and per rule sorted by id
	expect(trend[2]).toStrictEqual({
		at: '2026-08-20T09:00:00.000Z',
		path: '.',
		total: 2,
		blocking: 1,
		advisory: 1,
		byRule: [
			{ rule: 'multi-export', count: 1 },
			{ rule: 'size-function', count: 1 },
		],
	});
	// a clean check is a point too — a flat line at zero is the answer
	expect(trend[0]).toStrictEqual({ at: '2026-08-18T08:00:00.000Z', path: '.', total: 0, blocking: 0, advisory: 0, byRule: [] });
});

test('a dated file that is valid JSON but not a snapshot is left out of the trend', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });
	// what an older engine's format looks like from here: it parses as JSON and
	// answers to no version of the contract
	writeFileSync(join(cwd, '.lightsout', 'standards-check', 'legacy.json'), JSON.stringify({ at: '2026-08-17T00:00:00.000Z', violations: [] }));

	// the one readable snapshot still carries the trend
	expect((await listStandardsSnapshots({ cwd })).map((point) => point.at)).toStrictEqual(['2026-08-19T12:30:45.123Z']);
});

test('a rule breached at several sites is one row in the trend carrying its tally', async () => {
	const cwd = await freshRepo();
	const secondSite = {
		rule: 'multi-export',
		severity: StandardsSeverity.Blocking,
		siteKey: 'multi-export:src/b/config.ts',
		files: [{ path: 'src/b/config.ts' }],
		detail: 'two exports',
	};

	await writeStandardsSnapshot({ cwd, snapshot: snapshot({ findings: [...snapshot().findings, secondSite] }) });

	const trend = await listStandardsSnapshots({ cwd });

	// a chart plots one line per rule, so the sites collapse into a count rather
	// than repeating the rule id
	expect(trend[0]).toStrictEqual({
		at: '2026-08-19T12:30:45.123Z',
		path: '.',
		total: 2,
		blocking: 2,
		advisory: 0,
		byRule: [{ rule: 'multi-export', count: 2 }],
	});
});
