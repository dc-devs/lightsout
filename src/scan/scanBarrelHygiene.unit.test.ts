import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runScan } from '@/scan';

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-barrel-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

test('scanBarrelHygiene flags export * and module barrel entries no outside file consumes', async () => {
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

	const { findings: allFindings } = await runScan({ cwd: dir, persist: false });
	const findings = allFindings.filter((finding) => finding.detector === 'barrel-hygiene');

	const star = findings.filter((finding) => finding.cluster.startsWith('barrel-star:'));
	// export * flagged, root barrel excluded
	expect(star.map((finding) => finding.cluster)).toStrictEqual(['barrel-star:src/m/index.ts']);
	// star violations are findings
	expect(star.every((finding) => finding.severity === 'finding')).toBeTruthy();

	const dead = findings.filter((finding) => finding.cluster.startsWith('barrel-dead:'));
	// only the module entry no outside file consumes
	expect(dead.map((finding) => finding.cluster)).toStrictEqual(['barrel-dead:src/m/index.ts:orphan']);
	// barrel-dead is advisory
	expect(dead[0]?.severity === 'advisory').toBeTruthy();
	// the fact is the finding; what to do about it is the detector's guidance
	expect(dead[0]?.detail.includes('no file outside module')).toBeTruthy();
	// phrasing mirrors scanDeadExports
	expect(dead[0]?.guidance?.includes('public API') && dead[0].guidance.includes('dead')).toBeTruthy();
	// an externally consumed entry is live
	expect(dead.some((finding) => finding.cluster.includes(':used'))).toBeFalsy();
	// domain-folder entries are not boundary entries
	expect(dead.some((finding) => finding.cluster.includes('src/dom'))).toBeFalsy();
});

test('scanBarrelHygiene: a co-located test is a consumer of its own module barrel', async () => {
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

	const { findings } = await runScan({ cwd: dir, persist: false });
	const dead = findings.filter((finding) => finding.cluster.startsWith('barrel-dead:'));

	// a test-consumed entry is live:\n${JSON.stringify(dead, undefined, 1)}
	expect(dead.some((finding) => finding.cluster.includes(':tested'))).toBeFalsy();
	// an entry nothing consumes still flags
	expect(dead.some((finding) => finding.cluster.includes(':orphan'))).toBeTruthy();
});

test('scanBarrelHygiene skips barrel entries too short to word-match honestly', async () => {
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

	const { findings } = await runScan({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => finding.cluster.startsWith('barrel-dead:'));
	// the short entry is skipped, the long one flags
	expect(dead.map((finding) => finding.cluster)).toStrictEqual(['barrel-dead:src/m/index.ts:orphanEntry']);
});
