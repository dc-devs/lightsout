import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runScan } from '@/scan';

// scanDeadExports is a scan internal: its reference counting is observable
// only as the dead-export findings runScan reports. It is text-based, so
// these fixtures ship no typescript symlink.

const setup = (contents: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-dead-'));

	for (const [rel, content] of Object.entries(contents)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

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

	const { findings } = await runScan({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => finding.detector === 'dead-export');
	const tested = dead.find((finding) => finding.cluster === 'dead:src/util/onlyTested.ts');
	assert.ok(tested?.detail.includes('only by tests'), `a test is not production consumption:\n${JSON.stringify(dead, undefined, 1)}`);
	assert.ok(tested?.detail.includes("'onlyTested'"), 'the finding names the export');
	assert.equal(tested?.severity, 'advisory', 'dead-export findings are advisory — name counting is honest, not proof');
});

test('export names shorter than four characters are skipped — too common to word-match honestly', async () => {
	const dir = setup(testOnlyFiles);

	const { findings } = await runScan({ cwd: dir, persist: false });

	const dead = findings.filter((finding) => finding.detector === 'dead-export');
	assert.ok(dead.length > 0, 'the fixture does produce dead-export findings, so the exclusion below is not vacuous');
	assert.ok(!dead.some((finding) => finding.cluster === 'dead:src/util/tag.ts'), `'tag' is never a candidate:\n${JSON.stringify(dead, undefined, 1)}`);
});

test('a consumer outside the scanned path still counts as consumption', async () => {
	const dir = setup({
		'src/api/routeThing.ts': 'export const routeThing = () => 1;\n',
		'src/api/lonelyThing.ts': 'export const lonelyThing = () => 2;\n',
		// Outside the scanned subpath, so it is a reference file only — never a
		// scan target, but still a consumer.
		'app/main.ts': "import { routeThing } from '../src/api/routeThing';\n\nrouteThing();\n",
	});

	const { findings } = await runScan({ cwd: dir, path: 'src', persist: false });

	const dead = findings.filter((finding) => finding.detector === 'dead-export');
	assert.deepEqual(dead.map((finding) => finding.cluster), ['dead:src/api/lonelyThing.ts'], 'only the export nothing consumes');
	assert.ok(dead[0]?.detail.includes('referenced nowhere else'), `an unreferenced export is a delete candidate: ${dead[0]?.detail}`);
	assert.ok(
		findings.every((finding) => finding.files.every((file) => file.path.startsWith('src/'))),
		'the scanned path bounds what is reported, not what is searched',
	);
});
