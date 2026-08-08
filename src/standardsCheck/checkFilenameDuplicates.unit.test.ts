import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

// checkFilenameDuplicates is a standards-check internal: tier 0 runs inside
// runStandardsCheck, so its comparisons are observable only as the findings the check reports. Tier
// 0 needs no compiler, so these fixtures ship no typescript symlink.

const files = {
	// Every module barrel is named index — comparing those names would report
	// the whole repo as one duplicate concept.
	'src/a/index.ts': "export { parseToken } from './parseToken';\n",
	'src/b/index.ts': "export { parseToken } from './parseToken';\n",
	// The same export name declared in two places — the tier-0 positive control.
	'src/a/parseToken.ts': 'export const parseToken = () => 1;\n',
	'src/b/parseToken.ts': 'export const parseToken = () => 2;\n',
};

const setup = (contents: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-names-'));

	for (const [rel, content] of Object.entries(contents)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

const nameFindings = async (dir: string) => {
	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	return findings.filter((finding) => finding.rule === 'name-duplicate' || finding.rule === 'name-synonym');
};

test('tier 0 reports a same-name pair as one advisory site listing both paths', async () => {
	const dir = setup(files);

	const findings = await nameFindings(dir);

	const pair = findings.find((finding) => finding.siteKey === 'name-duplicate:src/a/parseToken.ts|src/b/parseToken.ts');
	// both declaration sites are listed
	expect(pair?.files.map((file) => file.path).sort()).toStrictEqual(['src/a/parseToken.ts', 'src/b/parseToken.ts']);
	// same-name siblings can be legitimate — advisory, never gating
	expect(pair?.severity).toBe('advisory');
	// the detail counts the sites: ${pair?.detail}
	expect(pair?.detail.includes('2 places')).toBeTruthy();
});

test('tier 0 keys a synonym pair by its normalized tokens, listing both spellings as one site', async () => {
	const dir = setup({
		'src/a/getUserData.ts': 'export const getUserData = () => 1;\n',
		'src/b/fetchUserData.ts': 'export const fetchUserData = () => 2;\n',
	});

	const findings = await nameFindings(dir);

	const synonyms = findings.find((finding) => finding.rule === 'name-synonym');
	// the identity is the paths the pair occupies, deduped and sorted — never the
	// token key it happened to group under
	expect(synonyms?.siteKey).toBe('name-synonym:src/a/getUserData.ts|src/b/fetchUserData.ts');
	// both declaration sites are listed
	expect(synonyms?.files.map((file) => file.path).sort()).toStrictEqual(['src/a/getUserData.ts', 'src/b/fetchUserData.ts']);
	// one concept under two names is a judgment call — advisory, never gating
	expect(synonyms?.severity).toBe('advisory');
	// the detail names both spellings: ${synonyms?.detail}
	expect(synonyms?.detail.includes("'getUserData'") && synonyms.detail.includes("'fetchUserData'")).toBeTruthy();
});

test('names identical up to casing and separators are a framework pair, not a synonym clash', async () => {
	const dir = setup({
		// A component and its kebab-case route file: one concept spelled two ways
		// because the framework demands it, not two names for one idea.
		'src/pages/GetStarted.tsx': 'export const GetStarted = () => null;\n',
		'src/routes/get-started.ts': 'export const getStartedRoute = 1;\n',
		// A genuine synonym pair, so the exclusion above is not vacuous.
		'src/a/getUserData.ts': 'export const getUserData = () => 1;\n',
		'src/b/fetchUserData.ts': 'export const fetchUserData = () => 2;\n',
	});

	const findings = await nameFindings(dir);

	// both pairs share a token key; only the one spelling a different word is a clash
	expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['name-synonym:src/a/getUserData.ts|src/b/fetchUserData.ts']);
});

test('index files are excluded from tier 0 — every barrel shares that name by convention', async () => {
	const dir = setup(files);

	const findings = await nameFindings(dir);

	// the fixture does produce tier-0 findings, so the exclusions below are not
	// vacuous
	expect(findings.length > 0).toBeTruthy();
	// two index.ts barrels are not a duplicate name, so no barrel appears in any
	// tier-0 finding — by name or by synonym key:\n${JSON.stringify(findings, undefined, 1)}
	expect(findings.some((finding) => finding.files.some((file) => file.path.endsWith('/index.ts')))).toBeFalsy();
});
