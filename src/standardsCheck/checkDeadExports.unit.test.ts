import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

// checkDeadExports is a standards-check internal: its reference counting is observable
// only as the dead-export findings runStandardsCheck reports. It is text-based, so
// these fixtures ship no typescript symlink.

const setup = (contents: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-dead-'));

	for (const [rel, content] of Object.entries(contents)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

/** The three verdicts this one pass produces, each its own rule. */
const deadRules: string[] = ['dead-export', 'test-only-export', 'barrel-only-export'];

const testOnlyFiles = {
	// Referenced by its own unit test and nothing else — production-dead.
	'src/util/onlyTested.ts': 'export const onlyTested = () => 1;\n',
	'src/util/onlyTested.unit.test.ts': "import { onlyTested } from './onlyTested';\n\nconsole.log(onlyTested());\n",
	// Three characters — below the whole-word matching floor, so it is never
	// a declaration candidate however unreferenced it is.
	'src/util/tag.ts': 'export const tag = () => 2;\n',
};

test('an export referenced only by tests is called production-dead, not dead outright', async () => {
	const dir = setup(testOnlyFiles);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => deadRules.includes(finding.rule));
	const tested = dead.find((finding) => finding.siteKey === 'test-only-export:src/util/onlyTested.ts');
	// a test is not production consumption:\n${JSON.stringify(dead, undefined, 1)}
	expect(tested?.detail.includes('only by tests')).toBeTruthy();
	// the finding names the export
	expect(tested?.detail.includes("'onlyTested'")).toBeTruthy();
	// dead-export findings are advisory — name counting is honest, not proof
	expect(tested?.severity).toBe('advisory');
});

test('export names shorter than four characters are skipped — too common to word-match honestly', async () => {
	const dir = setup(testOnlyFiles);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => deadRules.includes(finding.rule));
	// the fixture does produce dead-export findings, so the exclusion below is not
	// vacuous
	expect(dead.length > 0).toBeTruthy();
	// 'tag' is never a candidate:\n${JSON.stringify(dead, undefined, 1)}
	expect(dead.some((finding) => finding.files.some((file) => file.path === 'src/util/tag.ts'))).toBeFalsy();
});

test('a consumer outside the checked path still counts as consumption', async () => {
	const dir = setup({
		'src/api/routeThing.ts': 'export const routeThing = () => 1;\n',
		'src/api/lonelyThing.ts': 'export const lonelyThing = () => 2;\n',
		// Outside the checked subpath, so it is a reference file only — never a
		// check target, but still a consumer.
		'app/main.ts': "import { routeThing } from '../src/api/routeThing';\n\nrouteThing();\n",
	});

	const { findings } = await runStandardsCheck({ cwd: dir, path: 'src', persist: false });

	const dead = findings.filter((finding) => deadRules.includes(finding.rule));
	// only the export nothing consumes
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['dead-export:src/api/lonelyThing.ts']);
	// an unreferenced export is a delete candidate: ${dead[0]?.detail}
	expect(dead[0]?.detail.includes('referenced nowhere else')).toBeTruthy();
	// the checked path bounds what is reported, not what is searched
	expect(findings.every((finding) => finding.files.every((file) => file.path.startsWith('src/')))).toBeTruthy();
});

test('two unconsumed exports in one file are one finding, naming both', async () => {
	const dir = setup({
		'src/util/pair.ts': 'export const firstThing = () => 1;\nexport const secondThing = () => 2;\n',
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const dead = findings.filter((finding) => deadRules.includes(finding.rule));

	// one file, one row in the work-list
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['dead-export:src/util/pair.ts']);
	// both names are carried, and the phrasing follows the count: ${dead[0]?.detail}
	expect(dead[0]?.detail).toBe("'firstThing', 'secondThing' are referenced nowhere else");
});

test('a barrel-only export is its own rule — a deliberate public API is not the same claim as dead code', async () => {
	const dir = setup({
		// Re-exported and nothing else — the deliberate-public-API case.
		'src/mod/index.ts': "export { publicThing } from './publicThing';\n",
		'src/mod/publicThing.ts': 'export const publicThing = () => 1;\n',
		// Referenced by nothing at all — the plain dead-code case, so the two
		// verdicts are visibly separate rules rather than one bucket.
		'src/mod/strayThing.ts': 'export const strayThing = () => 2;\n',
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const barrelOnly = findings.filter((finding) => finding.rule === 'barrel-only-export');

	// switching this rule off must not take the other two verdicts with it
	expect(barrelOnly.map((finding) => finding.siteKey)).toStrictEqual(['barrel-only-export:src/mod/publicThing.ts']);
	expect(barrelOnly[0]?.detail.includes('no module consumes it')).toBeTruthy();
	expect(findings.filter((finding) => finding.rule === 'dead-export').map((finding) => finding.siteKey)).toStrictEqual(['dead-export:src/mod/strayThing.ts']);
});

test('an index file that only imports and runs is an ordinary consumer, not a barrel', async () => {
	const dir = setup({
		// An executable dispatcher: its name starts with `index.` but it exports
		// nothing, so a name it references is plain production consumption.
		'src/cli/index.ts': "import { runCommand } from './runCommand';\n\nrunCommand();\n",
		'src/cli/runCommand.ts': 'export const runCommand = () => 1;\n',
		// A real barrel, so the exclusion above is not vacuous.
		'src/mod/index.ts': "export { publicThing } from './publicThing';\n",
		'src/mod/publicThing.ts': 'export const publicThing = () => 1;\n',
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const dead = findings.filter((finding) => deadRules.includes(finding.rule));

	// counting the dispatcher as a barrel reported every CLI command as
	// barrel-only — it is a consumer, so runCommand is simply alive
	expect(dead.map((finding) => finding.siteKey)).toStrictEqual(['barrel-only-export:src/mod/publicThing.ts']);
});

test('an export reached from a barrel AND a test is claimed by no verdict at all', async () => {
	const dir = setup({
		'src/mod/index.ts': "export { bothWays } from './bothWays';\n",
		'src/mod/bothWays.ts': 'export const bothWays = () => 1;\n',
		'src/mod/bothWays.unit.test.ts': "import { bothWays } from './bothWays';\n\nconsole.log(bothWays());\n",
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// barrel plus test is neither "nowhere else", nor test-only, nor barrel-only
	expect(findings.some((finding) => deadRules.includes(finding.rule) && finding.files.some((file) => file.path === 'src/mod/bothWays.ts'))).toBeFalsy();
});
