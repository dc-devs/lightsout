import { expect, test } from '@jest/globals';
import { runCli } from '@tests/helpers/runCli';
import { seedStandardsFixture } from '@tests/helpers/seedStandardsFixture';

test('cli: standards-health reports every rule as machine-checked or judgment, and exits 0', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-health', '--cwd', cwd] });

	// the coverage claim is counted off the package's own folders, so it lands
	// even in a repo that has never run anything
	expect(stdout).toMatch(/│ name-synonym\s+│\s+code\s+│/);
	expect(stdout).toMatch(/│ path-aliases\s+│\s+judgment\s+│/);
	// a repo with no refactor history has nothing to say about declines, and says
	// so with a dash rather than a zero that would read as "never declined"
	expect(stdout).toMatch(/│ name-synonym\s+│\s+code\s+│\s+—\s+│\s+—\s+│\s+—\s+│\s+—\s+│\s+—\s+│\s+—\s+│\s+—\s+│/);
	expect(stdout).toMatch(/│ 133 rule\(s\)\s+│\s+50 by code, 83 by judgment\s+│/);
	// it reports on the rules, never on the code — nothing here to gate on
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
