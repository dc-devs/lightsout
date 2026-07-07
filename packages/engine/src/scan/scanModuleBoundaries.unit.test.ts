import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runScan } from './index';

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-boundary-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	// The boundary detector needs import resolution — hand the fixture our TS.
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

const boundaryFindings = async (dir: string) => {
	const { findings } = await runScan({ cwd: dir, persist: false });

	return findings.filter((finding) => finding.detector === 'module-boundary');
};

test('scanModuleBoundaries flags deep imports across a module boundary, allowing barrel / domain / common / same-module', async () => {
	const files = {
		// module a: barrel omits internal.ts
		'src/a/index.ts': "export { a } from './a';\n",
		'src/a/a.ts': 'export const a = 1;\n',
		'src/a/internal.ts': 'export const internal = 2;\n',
		'src/a/deep.ts': "import { internal } from './internal';\nexport const deep = internal;\n",
		'src/a/common/utils/helper.ts': 'export const helper = 3;\n',
		// domain folder fmt: barrel hides nothing
		'src/fmt/index.ts': "export { x } from './x';\nexport { y } from './y';\n",
		'src/fmt/x.ts': 'export const x = 1;\n',
		'src/fmt/y.ts': 'export const y = 2;\n',
		// consumers outside a
		'src/b/b.ts': "import { internal } from '../a/internal';\nexport const b = internal;\n",
		'src/b/viaBarrel.ts': "import { a } from '../a';\nexport const usesA = a;\n",
		'src/c/c.ts': "import { x } from '../fmt/x';\nexport const c = x;\n",
		'src/d/d.ts': "import { helper } from '../a/common/utils/helper';\nexport const d = helper;\n",
	};
	const dir = setup(files);

	const findings = await boundaryFindings(dir);
	const clusters = findings.map((finding) => finding.cluster);

	assert.ok(
		findings.every((finding) => finding.severity === 'finding'),
		'every module-boundary finding carries the finding severity',
	);
	assert.deepEqual(clusters.sort(), ['boundary:src/b/b.ts'], 'only the deep cross-boundary import flags');

	const flagged = findings.find((finding) => finding.cluster === 'boundary:src/b/b.ts');
	assert.deepEqual(flagged?.files.map((file) => file.path), ['src/b/b.ts', 'src/a/internal.ts'], 'files list is [importer, imported]');
	assert.ok(flagged?.detail.includes('src/a') && flagged.detail.includes('src/a/index.ts'), 'detail names the module and its barrel');
});

test('scanModuleBoundaries picks the OUTERMOST crossed module for nested modules', async () => {
	const files = {
		'src/outer/index.ts': "export { outer } from './outer';\n",
		'src/outer/outer.ts': 'export const outer = 1;\n',
		'src/outer/hidden.ts': 'export const hidden = 2;\n',
		'src/outer/mid.ts': "import { secret } from './inner/secret';\nexport const mid = secret;\n",
		'src/outer/inner/index.ts': "export { inner } from './inner';\n",
		'src/outer/inner/inner.ts': 'export const inner = 1;\n',
		'src/outer/inner/secret.ts': 'export const secret = 2;\n',
		// fully outside both modules — crosses outer first
		'src/ext/ext.ts': "import { secret } from '../outer/inner/secret';\nexport const ext = secret;\n",
	};
	const dir = setup(files);

	const findings = await boundaryFindings(dir);
	const byCluster = (cluster: string) => findings.find((finding) => finding.cluster === cluster);

	assert.ok(byCluster('boundary:src/ext/ext.ts')?.detail.includes("module 'src/outer'"), 'outsider crosses the OUTERMOST module first');
	assert.ok(!byCluster('boundary:src/ext/ext.ts')?.detail.includes("module 'src/outer/inner'"), 'not the inner module');
	assert.ok(byCluster('boundary:src/outer/mid.ts')?.detail.includes("module 'src/outer/inner'"), 'a file inside outer crosses only into inner');
});
