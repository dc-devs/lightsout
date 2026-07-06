import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { scanBarrelHygiene } from '../src/scan/scanBarrelHygiene';

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
	const list = Object.keys(files);

	const findings = await scanBarrelHygiene({ cwd: dir, files: list, referenceFiles: list });

	assert.ok(
		findings.every((finding) => finding.detector === 'barrel-hygiene'),
		'every finding is a barrel-hygiene finding',
	);

	const star = findings.filter((finding) => finding.cluster.startsWith('barrel-star:'));
	assert.deepEqual(star.map((finding) => finding.cluster), ['barrel-star:src/m/index.ts'], 'export * flagged, root barrel excluded');
	assert.ok(star.every((finding) => finding.severity === 'finding'), 'star violations are findings');

	const dead = findings.filter((finding) => finding.cluster.startsWith('barrel-dead:'));
	assert.deepEqual(dead.map((finding) => finding.cluster), ['barrel-dead:src/m/index.ts:orphan'], 'only the module entry no outside file consumes');
	assert.ok(dead[0]?.severity === 'advisory', 'barrel-dead is advisory');
	assert.ok(dead[0]?.detail.includes('public API') && dead[0].detail.includes('dead'), 'phrasing mirrors scanDeadExports');
	assert.ok(!dead.some((finding) => finding.cluster.includes(':used')), 'an externally consumed entry is live');
	assert.ok(!dead.some((finding) => finding.cluster.includes('src/dom')), 'domain-folder entries are not boundary entries');
});
