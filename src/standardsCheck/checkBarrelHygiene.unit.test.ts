import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-barrel-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

test('checkBarrelHygiene flags export * and module barrel entries no outside file consumes', async () => {
	const files = {
		// module m: barrel omits internal.ts, uses export *, and exposes an orphan
		'src/m/index.ts': "export { used } from './used';\nexport { orphan } from './orphan';\nexport * from './star';\n",
		'src/m/used.ts': 'export const used = 1;\n',
		'src/m/orphan.ts': 'export const orphan = 2;\n',
		'src/m/star.ts': 'export const starThing = 3;\n',
		'src/m/internal.ts': 'export const internal = 4;\n',
		// domain folder: barrel covers every file → check 2 must not run here
		'src/dom/index.ts': "export { primary } from './primary';\nexport { secondary } from './secondary';\n",
		'src/dom/primary.ts': 'export const primary = 1;\n',
		'src/dom/secondary.ts': 'export const secondary = 2;\n',
		// an outside consumer references only `used`
		'src/consumer.ts': "import { used } from './m';\nexport const consumer = used;\n",
		// a src-root barrel with export * → excluded (package API)
		'src/index.ts': "export * from './m';\n",
	};
	const dir = setup(files);

	const { findings: allFindings } = await runStandardsCheck({ cwd: dir, persist: false });
	const findings = allFindings.filter((finding) => finding.rule === 'barrel-star' || finding.rule === 'barrel-dead-entry');

	const star = findings.filter((finding) => finding.rule === 'barrel-star');
	// export * flagged, root barrel excluded
	expect(star.map((finding) => finding.siteKey)).toStrictEqual(['barrel-star:src/m/index.ts']);
	// star violations are findings
	expect(star.every((finding) => finding.severity === 'finding')).toBeTruthy();

	const dead = findings.filter((finding) => finding.rule === 'barrel-dead-entry');
	// only the module entry no outside file consumes — keyed on the barrel, so a
	// second orphan later joins this finding rather than minting a new identity
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['barrel-dead-entry:src/m/index.ts']);
	// barrel-dead is advisory
	expect(dead[0]?.severity === 'advisory').toBeTruthy();
	// the fact is the finding; what to do about it is the rule's guidance
	expect(dead[0]?.detail.includes('no file outside module')).toBeTruthy();
	// phrasing mirrors checkDeadExports
	expect(dead[0]?.guidance?.includes('public API') && dead[0].guidance.includes('dead')).toBeTruthy();
	// an externally consumed entry is live
	expect(dead.some((finding) => finding.detail.includes("'used'"))).toBeFalsy();
	// domain-folder entries are not boundary entries
	expect(dead.some((finding) => finding.siteKey.includes('src/dom'))).toBeFalsy();
});

test('checkBarrelHygiene: a co-located test is a consumer of its own module barrel', async () => {
	const files = {
		'src/m/index.ts': "export { tested } from './tested';\nexport { orphan } from './orphan';\n",
		'src/m/tested.ts': 'export const tested = 1;\n',
		'src/m/orphan.ts': 'export const orphan = 2;\n',
		'src/m/internal.ts': 'export const internal = 3;\n',
		// The only consumer of `tested` is a test file INSIDE the module — a
		// test is a client of the public surface wherever it sits.
		'src/m/tested.test.ts': "import { tested } from './index';\nconsole.log(tested);\n",
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const dead = findings.filter((finding) => finding.rule === 'barrel-dead-entry');

	// a test-consumed entry is live:\n${JSON.stringify(dead, undefined, 1)}
	expect(dead.some((finding) => finding.detail.includes("'tested'"))).toBeFalsy();
	// an entry nothing consumes still flags
	expect(dead.some((finding) => finding.detail.includes("'orphan'"))).toBeTruthy();
});

test('checkBarrelHygiene skips barrel entries too short to word-match honestly', async () => {
	const files = {
		// Both entries are unconsumed; only the four-character-or-longer one is
		// a candidate — `run` would word-match half the repo by accident.
		'src/m/index.ts': "export { run } from './run';\nexport { orphanEntry } from './orphanEntry';\n",
		'src/m/run.ts': 'export const run = 1;\n',
		'src/m/orphanEntry.ts': 'export const orphanEntry = 2;\n',
		// Omitted from the barrel, which is what makes src/m a module rather
		// than a domain folder — barrel-dead only runs on modules.
		'src/m/internal.ts': 'export const internal = 3;\n',
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => finding.rule === 'barrel-dead-entry');
	// the short entry is skipped, the long one flags
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['barrel-dead-entry:src/m/index.ts']);
	expect(dead[0]?.detail.startsWith("'orphanEntry' is exported from")).toBeTruthy();
});

test('checkBarrelHygiene: every unconsumed entry of one barrel is a single finding', async () => {
	const dir = setup({
		'src/m/index.ts': "export { usedThing } from './usedThing';\nexport { firstOrphan } from './firstOrphan';\nexport { secondOrphan } from './secondOrphan';\n",
		'src/m/usedThing.ts': 'export const usedThing = 1;\n',
		'src/m/firstOrphan.ts': 'export const firstOrphan = 2;\n',
		'src/m/secondOrphan.ts': 'export const secondOrphan = 3;\n',
		'src/m/internal.ts': 'export const internal = 4;\n',
		'src/consumer.ts': "import { usedThing } from './m';\nexport const consumer = usedThing;\n",
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const dead = findings.filter((finding) => finding.rule === 'barrel-dead-entry');

	// reviewing a barrel's surface is one job, not one per entry
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['barrel-dead-entry:src/m/index.ts']);
	// both orphans are named, and the phrasing follows the count: ${dead[0]?.detail}
	expect(dead[0]?.detail.startsWith("'firstOrphan', 'secondOrphan' are exported from")).toBeTruthy();
	expect(dead[0]?.detail.endsWith("consumes them")).toBeTruthy();
});
