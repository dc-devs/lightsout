import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

// mapFolderModules is a standards-check internal: its classification map is observable
// only through the findings the module-boundary and barrel-hygiene detectors
// derive from it. A `module`-status folder makes an outside deep import of its
// internal a boundary finding; a `domainFolder` (barrel hides nothing) does
// not; a common-segment or src-root folder is excluded from classification, so
// even its `export *` raises no barrel-star. These fixtures drive runStandardsCheck and
// assert those consequences.

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-modules-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	// The boundary detector (which consumes the classification) needs import
	// resolution — hand the fixture our TypeScript.
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

test('folder classification surfaces through boundary and barrel-star findings; common/ and src roots are excluded', async () => {
	const files = {
		// module: barrel omits internal.ts → an outside deep import of it flags
		'src/feat/index.ts': "export { feat } from './feat';\n",
		'src/feat/feat.ts': 'export const feat = 1;\n',
		'src/feat/internal.ts': 'export const internal = 2;\n',
		// domainFolder: barrel re-exports a AND b — hides nothing → deep import allowed
		'src/fmt/index.ts': "export { alpha } from './a';\nexport { bravo } from './b';\n",
		'src/fmt/a.ts': 'export const alpha = 1;\n',
		'src/fmt/b.ts': 'export const bravo = 2;\n',
		// module because it OWNS a common/ subfolder, though its barrel covers every
		// direct file; its export * barrel doubles as the barrel-star positive control
		'src/box/index.ts': "export * from './box';\n",
		'src/box/box.ts': 'export const box = 1;\n',
		'src/box/common/types/thing.ts': 'export type Thing = 1;\n',
		// under a common/ segment → excluded from classification: its export * raises no star
		'src/feat/common/utils/index.ts': "export * from './helper';\n",
		'src/feat/common/utils/helper.ts': 'export const helper = 1;\n',
		// package/repo src-root barrel → excluded: its export * raises no star
		'src/index.ts': "export * from './feat';\n",
		// outside consumers deep-importing each folder's files drive the boundary findings
		'src/useInternal/u.ts': "import { internal } from '../feat/internal';\nexport const u = internal;\n",
		'src/useFmt/u.ts': "import { alpha } from '../fmt/a';\nexport const u = alpha;\n",
		'src/useBox/u.ts': "import { box } from '../box/box';\nexport const u = box;\n",
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const boundary = findings.filter((finding) => finding.rule === 'module-boundary');
	const star = findings.filter((finding) => finding.rule === 'barrel-hygiene' && finding.siteKey.startsWith('barrel-star:'));

	// module: feat's barrel omits internal.ts, so the deep import flags — naming the module and its barrel
	const feat = boundary.find((finding) => finding.siteKey === 'boundary:src/useInternal/u.ts');
	// feat is classified a module — its internal deep import flags
	expect(feat?.detail.includes("module 'src/feat'")).toBeTruthy();
	// the finding names feat’s barrel path
	expect(feat?.detail.includes('src/feat/index.ts')).toBeTruthy();

	// domainFolder: fmt's barrel re-exports both files, hiding nothing → the deep import does NOT flag
	// fmt is a domainFolder — deep import allowed, no boundary finding
	expect(boundary.some((finding) => finding.siteKey === 'boundary:src/useFmt/u.ts')).toBeFalsy();

	// module via own common/: box's barrel covers box.ts, yet owning common/ forces module status
	// box is a module because it owns a common/ subfolder
	expect(boundary.some((finding) => finding.siteKey === 'boundary:src/useBox/u.ts' && finding.detail.includes("module 'src/box'"))).toBeTruthy();

	// common-segment and src-root barrels are excluded from the module map, so their
	// export * raises no star — only the genuine module barrel (box) does
	// excluded folders raise no barrel-star; the module barrel does
	expect(star.map((finding) => finding.siteKey)).toStrictEqual(['barrel-star:src/box/index.ts']);
});

test('nested-module chains defer the parent to domainFolder — the OUTERMOST crossed module is the child', async () => {
	const files = {
		// parent whose only non-index descendants live inside a nested module
		'src/group/index.ts': "export { child } from './child';\n",
		'src/group/child/index.ts': "export { child } from './child';\n",
		'src/group/child/child.ts': 'export const child = 1;\n',
		'src/group/child/hidden.ts': 'export const hidden = 2;\n',
		// an outside consumer deep-imports the nested module's hidden internal
		'src/useNested/u.ts': "import { hidden } from '../group/child/hidden';\nexport const u = hidden;\n",
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const boundary = findings.filter((finding) => finding.rule === 'module-boundary');
	const nested = boundary.find((finding) => finding.siteKey === 'boundary:src/useNested/u.ts');

	// child still hides hidden.ts → it is a module; group's only descendants live in
	// child, so with the nested subtree removed group omits nothing → domainFolder.
	// The boundary therefore names the child, not the deferred parent.
	// the nested module child is crossed
	expect(nested?.detail.includes("module 'src/group/child'")).toBeTruthy();
	// group deferred to domainFolder — never the crossed module
	expect(nested?.detail.includes("module 'src/group'")).toBeFalsy();
});

/** A folder whose barrel cannot be read: index.ts is a symlink pointing at a file that does not exist. */
const setupUnreadableBarrel = () => {
	const dir = setup({
		'src/broken/thing.ts': 'export const thing = 1;\n',
		'src/useBroken/u.ts': "import { thing } from '../broken/thing';\nexport const u = thing;\n",
	});

	symlinkSync(join(dir, 'src/broken/nowhere.ts'), join(dir, 'src/broken/index.ts'));

	return dir;
};

test('a barrel that cannot be read exports nothing, so its folder stays a module and deep imports still flag', async () => {
	const dir = setupUnreadableBarrel();

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const boundary = findings.filter((finding) => finding.rule === 'module-boundary');
	const broken = boundary.find((finding) => finding.siteKey === 'boundary:src/useBroken/u.ts');

	// a barrel nobody can read is assumed to hide everything — the safe
	// direction: it never silently opens the module it fronts
	expect(broken?.detail.includes("module 'src/broken'")).toBeTruthy();
	// the finding still points at the barrel the import should have gone through
	expect(broken?.detail.includes('src/broken/index.ts')).toBeTruthy();
});
