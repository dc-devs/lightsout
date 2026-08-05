import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runScan } from '@/scan';

// scanFilenameDuplicates is a scan internal: tier 0 runs inside runScan, so
// its comparisons are observable only as the findings the scan reports. Tier
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
	const { findings } = await runScan({ cwd: dir, persist: false });

	return findings.filter((finding) => finding.detector === 'filename-duplicate');
};

test('tier 0 reports a same-name pair as one advisory cluster listing both sites', async () => {
	const dir = setup(files);

	const findings = await nameFindings(dir);

	const pair = findings.find((finding) => finding.cluster === 'name:parseToken');
	assert.deepEqual(pair?.files.map((file) => file.path).sort(), ['src/a/parseToken.ts', 'src/b/parseToken.ts'], 'both declaration sites are listed');
	assert.equal(pair?.severity, 'advisory', 'same-name siblings can be legitimate — advisory, never gating');
	assert.ok(pair?.detail.includes('2 places'), `the detail counts the sites: ${pair?.detail}`);
});

test('index files are excluded from tier 0 — every barrel shares that name by convention', async () => {
	const dir = setup(files);

	const findings = await nameFindings(dir);

	assert.ok(findings.length > 0, 'the fixture does produce tier-0 findings, so the exclusions below are not vacuous');
	assert.ok(!findings.some((finding) => finding.cluster === 'name:index'), `two index.ts barrels are not a duplicate name:\n${JSON.stringify(findings, undefined, 1)}`);
	assert.ok(
		!findings.some((finding) => finding.files.some((file) => file.path.endsWith('/index.ts'))),
		'no barrel appears in any tier-0 finding, by name or by synonym key',
	);
});
