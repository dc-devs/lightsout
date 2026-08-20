import { writeFileSync } from 'node:fs';
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

const freshRepo = () => mkdtemp(join(tmpdir(), 'lightsout-read-snapshot-'));

test('a repo that has never run a check reads as an absence, not an error', async () => {
	const cwd = await freshRepo();

	// the standards view has to render on a fresh clone
	expect(await readStandardsSnapshot({ cwd })).toBe(undefined);
});

test('a latest snapshot that will not read is an absence rather than a throw', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });
	// what a hand-edited work-list looks like from here — the latest file is the
	// one the refactor pipeline reads, so it is the one most likely to be touched
	writeFileSync(join(cwd, '.lightsout', 'standards-check.json'), '{ not json');

	// validated like any other file, so a damaged work-list reads as "no check
	// has run" rather than throwing on the reader
	expect(await readStandardsSnapshot({ cwd })).toBe(undefined);
});

test('a named dated file is readable on its own, and a name nothing answers to reads as absent', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });

	expect((await readStandardsSnapshot({ cwd, fileName: '2026-08-19T12-30-45-123Z.json' }))?.path).toBe('.');
	// a name nothing answers to is an absence, like the missing latest file
	expect(await readStandardsSnapshot({ cwd, fileName: 'not-a-snapshot.json' })).toBe(undefined);
});

test('a dated file that is valid JSON but not a snapshot reads as absent', async () => {
	const cwd = await freshRepo();

	await writeStandardsSnapshot({ cwd, snapshot: snapshot() });
	// what an older engine's format looks like from here: it parses as JSON and
	// answers to no version of the contract
	writeFileSync(join(cwd, '.lightsout', 'standards-check', 'legacy.json'), JSON.stringify({ at: '2026-08-17T00:00:00.000Z', violations: [] }));

	// validated at the boundary, so a reader never renders a half-shaped snapshot
	expect(await readStandardsSnapshot({ cwd, fileName: 'legacy.json' })).toBe(undefined);
});
