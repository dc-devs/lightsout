import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

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
	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	return findings.filter((finding) => finding.rule === 'module-boundary');
};

test('checkModuleBoundaries flags deep imports across a module boundary, allowing barrel / domain / common / same-module', async () => {
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
	const siteKeys = findings.map((finding) => finding.siteKey);

	// every module-boundary finding carries the finding severity
	expect(findings.every((finding) => finding.severity === 'finding')).toBeTruthy();
	// only the deep cross-boundary import flags
	expect(siteKeys.sort()).toStrictEqual(['boundary:src/b/b.ts']);

	const flagged = findings.find((finding) => finding.siteKey === 'boundary:src/b/b.ts');
	// files list is [importer, imported]
	expect(flagged?.files.map((file) => file.path)).toStrictEqual(['src/b/b.ts', 'src/a/internal.ts']);
	// detail names the module and its barrel
	expect(flagged?.detail.includes('src/a') && flagged.detail.includes('src/a/index.ts')).toBeTruthy();
});

test('checkModuleBoundaries picks the OUTERMOST crossed module for nested modules', async () => {
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
	const bySiteKey = (siteKey: string) => findings.find((finding) => finding.siteKey === siteKey);

	// outsider crosses the OUTERMOST module first
	expect(bySiteKey('boundary:src/ext/ext.ts')?.detail.includes("module 'src/outer'")).toBeTruthy();
	// not the inner module
	expect(bySiteKey('boundary:src/ext/ext.ts')?.detail.includes("module 'src/outer/inner'")).toBeFalsy();
	// a file inside outer crosses only into inner
	expect(bySiteKey('boundary:src/outer/mid.ts')?.detail.includes("module 'src/outer/inner'")).toBeTruthy();
});

test('two spellings of the same deep import are one violation, not two', async () => {
	const files = {
		'src/a/index.ts': "export { a } from './a';\n",
		'src/a/a.ts': 'export const a = 1;\n',
		'src/a/internal.ts': 'export const internal = 2;\nexport type Internal = number;\n',
		// Extensionless and extension-bearing specifiers resolve to the same
		// file — the importer crossed one boundary, so it earns one finding.
		'src/b/b.ts': "import { internal } from '../a/internal';\nimport type { Internal } from '../a/internal.ts';\n\nexport const b: Internal = internal;\n",
	};
	const dir = setup(files);

	const findings = await boundaryFindings(dir);

	// the repeated edge is deduplicated
	expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['boundary:src/b/b.ts']);
	// files list is [importer, imported]
	expect(findings[0]?.files.map((file) => file.path)).toStrictEqual(['src/b/b.ts', 'src/a/internal.ts']);
});
