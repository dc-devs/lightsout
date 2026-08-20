import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { StandardsSeverity, type StandardsSnapshot } from '#src/contracts/index.ts';
import { readStandardsSnapshot, writeStandardsSnapshot } from '#src/standardsCheck/index.ts';

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

const freshRepo = () => mkdtemp(join(tmpdir(), 'lightsout-snapshot-'));

test('a snapshot is persisted twice: as the latest report, and as a dated copy the trend reads', async () => {
	const cwd = await freshRepo();
	const written = snapshot();

	await writeStandardsSnapshot({ cwd, snapshot: written });

	const raw = readFileSync(join(cwd, '.lightsout', 'standards-check.json'), 'utf8');

	// the bytes the refactor pipeline reads as its work-list: tab-indented, keys
	// in declaration order, one trailing newline
	expect(raw.startsWith('{\n\t"at": "2026-08-19T12:30:45.123Z",\n\t"path": ".",')).toBe(true);
	expect(raw.endsWith('}\n')).toBe(true);
	// and it round-trips through the contract that describes it
	await expect(readStandardsSnapshot({ cwd })).resolves.toStrictEqual(written);

	const dated = readdirSync(join(cwd, '.lightsout', 'standards-check'));

	// one dated copy, named for the moment the check ran — no colons, which a
	// Windows filesystem refuses in a filename
	expect(dated).toStrictEqual(['2026-08-19T12-30-45-123Z.json']);
	expect(JSON.parse(readFileSync(join(cwd, '.lightsout', 'standards-check', dated[0]), 'utf8'))).toStrictEqual(written);
});

test('the dated copies accumulate while the latest file is overwritten', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });
	await writeStandardsSnapshot({ cwd, snapshot: snapshot({ at: '2026-08-20T09:00:00.000Z', findings: [], notes: [] }) });

	// history is kept, never rotated
	expect(readdirSync(join(cwd, '.lightsout', 'standards-check')).sort()).toStrictEqual(['2026-08-19T12-30-45-123Z.json', '2026-08-20T09-00-00-000Z.json']);
	// the latest file holds the newer run
	expect((await readStandardsSnapshot({ cwd }))?.at).toBe('2026-08-20T09:00:00.000Z');
});
