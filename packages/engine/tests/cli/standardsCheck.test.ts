import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runCli } from '@tests/helpers/runCli';
import { seedStandardsFixture } from '@tests/helpers/seedStandardsFixture';

test('cli: standards-check prints each finding, the rule breakdown, and exits 0', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--cwd', cwd] });

	expect(stderr).toBe('');
	// each rule gets a heading carrying its severity and count
	expect(stdout).toMatch(/ℹ name-synonym · 1 advisory/);
	// the shared guidance is stated once, under the rows it covers
	expect(stdout).toContain('Likely one concept living under two names.');
	// and the tally is a table, closed off by the report path
	expect(stdout).toMatch(/│ name-synonym\s+│\s+—\s+│\s+1\s+│/);
	// the rule's summary rides under its own row — a rule id alone says nothing
	expect(stdout).toMatch(/│ export names differing only by synonym or word order\s+│/);
	expect(stdout).toMatch(/report: \.lightsout\/standards-check\.json\n$/);
	// the standards check reports; it never fails the caller
	expect(code).toBe(0);
});

test('cli: standards-check counts advisories apart from findings and does not call them debt', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--cwd', cwd] });

	// the fixture plants a synonym pair and the two unreferenced exports behind
	// it — all advice to weigh, none of it work
	expect(stdout).toMatch(/│ total\s+│\s+—\s+│\s+3\s+│/);
	// so the accept-as-debt hint stays quiet — advice is not a ledger entry
	expect(stdout.includes('--baseline')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check writes its typed report to .lightsout/standards-check.json', async () => {
	const { cwd } = await seedStandardsFixture();

	const { code } = await runCli({ args: ['standards-check', '--code-checks', '--cwd', cwd] });

	const report = JSON.parse(await readFile(join(cwd, '.lightsout', 'standards-check.json'), 'utf8'));
	expect(report.path).toBe('.');
	// the evidence file carries the findings, not just the printed summary
	expect(report.findings.some((finding: { rule: string }) => finding.rule === 'name-synonym')).toBeTruthy();
	expect(code).toBe(0);
});

test('cli: standards-check renders a degraded check tier as a note instead of failing', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--cwd', cwd] });

	expect(stdout).toMatch(/ℹ [^\n]*no typescript resolvable from the target repo/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --baseline writes the debt ledger and exits 0', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--baseline', '--cwd', cwd] });

	const ledger = JSON.parse(await readFile(join(cwd, 'lightsout.standards-baseline.json'), 'utf8'));
	expect(ledger.path).toBe('.');
	// the accepted sites are what future runs measure against
	expect(ledger.siteKeys.length > 0).toBeTruthy();
	expect(stdout).toMatch(/ℹ baseline written: \d+ site\(s\) accepted as existing debt/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check reports nothing new once the findings are baselined', async () => {
	const { cwd } = await seedStandardsFixture({ baseline: true });

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--cwd', cwd] });

	// a baselined finding is accepted debt, not news
	expect(stdout.includes('name-synonym')).toBeFalsy();
	// nothing left to report reads as a sentence, not an empty table
	expect(stdout).toContain('clean — nothing blocking, no advisories');
	expect(stdout.includes('┌')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --all reports the findings the baseline already accepted', async () => {
	const { cwd } = await seedStandardsFixture({ baseline: true });

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--all', '--cwd', cwd] });

	// a baselined site is printed again under --all
	expect(stdout).toMatch(/ℹ name-synonym · 1 advisory/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --list prints the enforcement ledger and runs no check', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--list', '--cwd', cwd] });

	// every rule is listed with the state it runs at, who checks it, and the doc it enforces
	expect(stdout).toMatch(/│ name-synonym\s+│\s+advisory\s+│\s+code\s+│\s+lightsout-defaults: code\/style-guide\/conventions\/naming\s+│/);
	expect(stdout).toMatch(/│ module-boundary\s+│\s+blocking\s+│\s+code\s+│/);
	// a rule no check covers is listed too, and says so
	expect(stdout).toMatch(/│ path-aliases\s+│\s+advisory\s+│\s+judgment\s+│\s+lightsout-defaults: code\/style-guide\/structure\/import-paths\s+│/);
	// a rule's live numbers ride its summary line
	expect(stdout).toContain('minTokens 50');
	// the totals close it off, counting both kinds of rule
	expect(stdout).toMatch(/│ 134 rule\(s\)\s+│\s+30 blocking\s+│\s+104 advisory, 0 off\s+│\s+51 by code, 83 by judgment\s+│/);
	// the test-shape rules name the document they enforce
	expect(stdout).toMatch(/│ test-nested-describe\s+│\s+blocking\s+│\s+code\s+│\s+lightsout-defaults: tests\/unit-testing\s+│/);
	// and so do the file-placement rules, across the three docs they come from
	expect(stdout).toMatch(/│ path-banned-module-name\s+│\s+blocking\s+│\s+code\s+│\s+lightsout-defaults: code\/architecture\/folder-structure\s+│/);
	expect(stdout).toMatch(/│ path-common-barrel\s+│\s+blocking\s+│\s+code\s+│\s+lightsout-defaults: code\/style-guide\/structure\/module-api\s+│/);
	expect(stdout).toMatch(/│ path-folder-casing\s+│\s+advisory\s+│\s+code\s+│\s+lightsout-defaults: code\/architecture\/folder-structure\s+│/);
	// --list answers a question about configuration — it never checks the tree
	expect(stdout.includes('report: .lightsout/standards-check.json')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --list marks the rules this repo configured', async () => {
	const { cwd } = await seedStandardsFixture({ config: { 'standards-checks': { 'name-synonym': 'off' } } });

	const { stdout, code } = await runCli({ args: ['standards-check', '--list', '--cwd', cwd] });

	// "this is our policy" reads apart from "this is the default"
	expect(stdout).toMatch(/│ name-synonym\s+│\s+off \(config\)\s+│/);
	expect(stdout).toMatch(/│ 134 rule\(s\)\s+│\s+30 blocking\s+│\s+103 advisory, 1 off\s+│\s+51 by code, 83 by judgment\s+│/);
	expect(code).toBe(0);
});

test('cli: standards-check --path narrows the run to one subtree', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--code-checks', '--path', 'src/a', '--cwd', cwd] });

	// the synonym pair is split by the narrowed scope, so tier 0 has nothing to
	// pair
	expect(stdout.includes('name-synonym')).toBeFalsy();
	const report = JSON.parse(await readFile(join(cwd, '.lightsout', 'standards-check.json'), 'utf8'));
	// the flag reaches the engine as the checked subpath
	expect(report.path).toBe('src/a');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
