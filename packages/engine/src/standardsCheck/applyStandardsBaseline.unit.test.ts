import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { applyStandardsBaseline } from '#src/standardsCheck/applyStandardsBaseline.ts';

const finding = (siteKey: string, severity: StandardsFinding['severity'] = StandardsSeverity.Blocking): StandardsFinding => ({
	rule: siteKey.split(':')[0] ?? 'multi-export',
	severity,
	siteKey,
	files: [{ path: siteKey.split(':')[1] ?? 'src/a.ts' }],
	detail: 'planted',
});

/** A repo root holding whichever ledger the case starts from. */
const setupRepo = ({ ledger }: { ledger?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-baseline-'));

	if (ledger !== undefined) {
		writeFileSync(join(cwd, 'lightsout.standards-baseline.json'), ledger);
	}

	return cwd;
};

const existingLedger = JSON.stringify({
	at: '2026-01-01T00:00:00.000Z',
	path: '.',
	siteKeys: ['multi-export:src/a/config.ts', 'multi-export:src/gone/removed.ts'],
});

describe('applyStandardsBaseline', () => {
	test('with no ledger everything is reported, and blocking findings earn the accept-debt hint', async () => {
		const findings = [finding('multi-export:src/a/config.ts')];

		const applied = await applyStandardsBaseline({ cwd: setupRepo(), findings, all: false, writeBaseline: false });

		expect(applied.reported).toStrictEqual(findings);
		expect(applied.notes.some((note) => note.includes('--baseline'))).toBe(true);
	});

	test('an advisory-only report gets no accept-debt hint — advice is judged in place, never ledgered', async () => {
		const cwd = setupRepo();

		const applied = await applyStandardsBaseline({
			cwd,
			findings: [finding('size-function:src/a.ts', StandardsSeverity.Advisory)],
			all: false,
			writeBaseline: false,
		});

		expect(applied.notes).toStrictEqual([]);
		expect(existsSync(join(cwd, 'lightsout.standards-baseline.json'))).toBe(false);
	});

	test('writeBaseline writes the ledger with one entry per distinct site and still reports everything', async () => {
		const cwd = setupRepo();
		const findings = [finding('multi-export:src/a/config.ts'), finding('multi-export:src/a/config.ts'), finding('duplicate-code-block:src/b.ts')];

		const applied = await applyStandardsBaseline({ cwd, findings, all: false, writeBaseline: true });

		const ledger = JSON.parse(readFileSync(join(cwd, 'lightsout.standards-baseline.json'), 'utf8')) as { path: string; siteKeys: string[] };

		expect(ledger.path).toBe('.');
		expect([...ledger.siteKeys].sort()).toStrictEqual(['duplicate-code-block:src/b.ts', 'multi-export:src/a/config.ts']);
		// accepting debt says how much of it was accepted, and reports the full picture
		expect(applied.notes.some((note) => note.includes('baseline written: 2 site(s)'))).toBe(true);
		expect(applied.reported).toStrictEqual(findings);
	});

	test('a baselined site is suppressed with a note; a fresh one is reported; --all includes both', async () => {
		const cwd = setupRepo({ ledger: existingLedger });
		const findings = [finding('multi-export:src/a/config.ts'), finding('multi-export:src/b/config.ts')];

		const applied = await applyStandardsBaseline({ cwd, findings, all: false, writeBaseline: false });

		// suppression is stated, not silent
		expect(applied.reported.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/b/config.ts']);
		expect(applied.notes.some((note) => note.includes('1 baselined finding(s) suppressed'))).toBe(true);

		const everything = await applyStandardsBaseline({ cwd, findings, all: true, writeBaseline: false });

		expect(everything.reported).toStrictEqual(findings);
	});

	test('an unreadable ledger is called out and ignored — nothing is silently suppressed', async () => {
		const cwd = setupRepo({ ledger: '{ this is not json' });
		const findings = [finding('multi-export:src/a/config.ts')];

		const applied = await applyStandardsBaseline({ cwd, findings, all: false, writeBaseline: false });

		expect(applied.notes.some((note) => note.includes('unreadable'))).toBe(true);
		expect(applied.reported).toStrictEqual(findings);
	});

	test('a baselined site that no longer exists is reported as burn-down progress', async () => {
		const cwd = setupRepo({ ledger: existingLedger });

		const applied = await applyStandardsBaseline({ cwd, findings: [finding('multi-export:src/a/config.ts')], all: false, writeBaseline: false });

		expect(applied.reported).toStrictEqual([]);
		expect(applied.notes.some((note) => note.includes('1 baselined site(s) no longer found'))).toBe(true);
	});

	test('re-accepting debt refreshes the ledger to what is true now, dropping the sites already burned down', async () => {
		const cwd = setupRepo({ ledger: existingLedger });

		const applied = await applyStandardsBaseline({ cwd, findings: [finding('multi-export:src/a/config.ts')], all: false, writeBaseline: true });

		const ledger = JSON.parse(readFileSync(join(cwd, 'lightsout.standards-baseline.json'), 'utf8')) as { siteKeys: string[] };

		// a site that no longer exists is not carried forward, and an existing
		// ledger is refreshed, not written for the first time
		expect(ledger.siteKeys).toStrictEqual(['multi-export:src/a/config.ts']);
		expect(applied.notes.some((note) => note.includes('baseline refreshed'))).toBe(true);
	});
});
