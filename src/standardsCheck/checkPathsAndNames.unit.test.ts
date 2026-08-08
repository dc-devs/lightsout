import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

/**
 * A temp repo rather than a committed fixture: every rule here judges folder
 * NAMES, so a fixture tree carrying `helpers/` and `user-profile/` would be a
 * genuine violation of this repo's own standards sitting in version control.
 */
const setupPathsRepo = ({ files }: { files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-paths-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return { dir };
};

const keysFor = ({ findings, rule }: { findings: Array<{ rule: string; siteKey: string }>; rule: string }) =>
	findings.filter((finding) => finding.rule === rule).map((finding) => finding.siteKey);

describe('checkPathsAndNames folder rules', () => {
	test('flags a folder named for the role of its code, and never the four names common/ owns', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'src/billing/helpers/formatAmount.ts': 'export const formatAmount = () => 1;\n',
				'src/billing/utils/formatDate.ts': 'export const formatDate = () => 2;\n',
				// the same two names inside common/ are its own closed vocabulary
				'src/billing/common/utils/formatTax.ts': 'export const formatTax = () => 3;\n',
				'src/billing/common/types/Invoice.ts': 'export interface Invoice {\n\tid: string;\n}\n',
				// outside a package's src/, folder-structure.md never applied
				'tests/helpers/seedRepo.ts': 'export const seedRepo = () => 4;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual([
			'path-banned-module-name:src/billing/helpers',
			'path-banned-module-name:src/billing/utils',
		]);
		// a closed list from the doc, so a hit is a violation and not a judgment call
		expect(findings.find((finding) => finding.rule === 'path-banned-module-name')?.severity).toBe('finding');
		expect(findings.find((finding) => finding.rule === 'path-banned-module-name')?.detail).toBe("folder 'helpers' names the role of the code it holds");
	});

	test('names every folder on the closed list, and none of the four that are common/ own vocabulary', async () => {
		const { dir } = setupPathsRepo({
			files: {
				// banned at every level: a folder named for the role of its code
				'src/tier/helpers/a.ts': 'export const a = 1;\n',
				'src/tier/lib/b.ts': 'export const b = 2;\n',
				'src/tier/core/c.ts': 'export const c = 3;\n',
				'src/tier/misc/d.ts': 'export const d = 4;\n',
				'src/tier/shared/e.ts': 'export const e = 5;\n',
				'src/tier/controllers/f.ts': 'export const f = 6;\n',
				'src/tier/models/g.ts': 'export const g = 7;\n',
				'src/tier/hooks/h.ts': 'export const h = 8;\n',
				'src/tier/components/i.ts': 'export const i = 9;\n',
				// banned only outside common/, where these four are the mandated skeleton
				'src/tier/utils/j.ts': 'export const j = 10;\n',
				'src/tier/services/k.ts': 'export const k = 11;\n',
				'src/tier/types/L.ts': 'export interface L {\n\tid: string;\n}\n',
				'src/tier/constants/m.ts': 'export const m = 13;\n',
				'src/mod/common/utils/n.ts': 'export const n = 14;\n',
				'src/mod/common/services/o.ts': 'export const o = 15;\n',
				'src/mod/common/types/P.ts': 'export interface P {\n\tid: string;\n}\n',
				'src/mod/common/constants/q.ts': 'export const q = 17;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		// the whole list restated independently: a name dropped from the source set
		// silently stops being enforced, and nothing else here would notice
		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual([
			'path-banned-module-name:src/tier/components',
			'path-banned-module-name:src/tier/constants',
			'path-banned-module-name:src/tier/controllers',
			'path-banned-module-name:src/tier/core',
			'path-banned-module-name:src/tier/helpers',
			'path-banned-module-name:src/tier/hooks',
			'path-banned-module-name:src/tier/lib',
			'path-banned-module-name:src/tier/misc',
			'path-banned-module-name:src/tier/models',
			'path-banned-module-name:src/tier/services',
			'path-banned-module-name:src/tier/shared',
			'path-banned-module-name:src/tier/types',
			'path-banned-module-name:src/tier/utils',
		]);
	});

	test("honours each package's own framework carve-outs rather than the repo-wide union", async () => {
		const { dir } = setupPathsRepo({
			files: {
				'package.json': '{"name":"web","dependencies":{"react":"^18.0.0"}}\n',
				// React mandates a feature's own components/ and hooks/
				'src/feature/components/Card.tsx': 'export const Card = () => null;\n',
				'src/feature/hooks/useCard.ts': 'export const useCard = () => 1;\n',
				// models/ is on the banned list and React mandates nothing about it
				'src/feature/models/Invoice.ts': 'export interface Invoice {\n\tid: string;\n}\n',
				'packages/api/package.json': '{"name":"api","devDependencies":{"@nestjs/core":"^10.0.0"}}\n',
				'packages/api/src/controllers/user.controller.ts': 'export const userController = () => 1;\n',
				'packages/api/src/user-profile/get-profile.ts': 'export const getProfile = () => 2;\n',
				// an unreadable manifest names no package, so nothing anchors its src/
				'packages/broken/package.json': 'not json at all\n',
				'packages/broken/src/helpers/build.ts': 'export const build = () => 3;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		// only the folder no framework mandates
		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual(['path-banned-module-name:src/feature/models']);
		// NestJS mandates kebab-case throughout, so its own folders are never flagged
		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual([]);
	});

	test('exempts a route directory whose segments are URL-mapped, and nothing else in the package', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'package.json': '{"name":"web","dependencies":{"next":"^14.0.0"}}\n',
				'src/app/user-name/page.tsx': 'export const Page = () => null;\n',
				// an ordinary domain folder gets no route carve-out
				'src/domain/other-name/getThing.ts': 'export const getThing = () => 1;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual(['path-folder-casing:src/domain/other-name']);
	});

	test.each([
		{ dependency: 'next', root: 'pages' },
		{ dependency: '@tanstack/react-router', root: 'routes' },
		{ dependency: '@remix-run/react', root: 'routes' },
		{ dependency: 'expo-router', root: 'app' },
	])('$dependency exempts its own $root/ directory and nothing else', async ({ dependency, root }) => {
		const { dir } = setupPathsRepo({
			files: {
				'package.json': `{"name":"web","dependencies":{"${dependency}":"^1.0.0"}}\n`,
				[`src/${root}/user-name/screen.tsx`]: 'export const Screen = () => null;\n',
				'src/domain/other-name/getThing.ts': 'export const getThing = () => 1;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual(['path-folder-casing:src/domain/other-name']);
	});

	test('reads the same React layout carve-out from react-dom as from react', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'package.json': '{"name":"web","devDependencies":{"react-dom":"^18.0.0"}}\n',
				'src/feature/components/Card.tsx': 'export const Card = () => null;\n',
				'src/feature/hooks/useCard.ts': 'export const useCard = () => 1;\n',
				// core/ is on the banned list and React mandates nothing about it
				'src/feature/core/engine.ts': 'export const engine = () => 2;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual(['path-banned-module-name:src/feature/core']);
	});

	test("gives a package whose manifest names no framework the doc's plain defaults", async () => {
		const { dir } = setupPathsRepo({
			files: {
				// a readable manifest with no framework signal earns no exemption at all
				'package.json': '{"name":"web","dependencies":{"zod":"^3.0.0"}}\n',
				'src/feature/components/Card.tsx': 'export const Card = () => null;\n',
				'src/feature/one-off/getThing.ts': 'export const getThing = () => 1;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual(['path-banned-module-name:src/feature/components']);
		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual(['path-folder-casing:src/feature/one-off']);
	});

	test('flags a file sitting directly in common/ and a barrel anywhere under it, one finding each', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'src/billing/common/rate.ts': 'export const rate = 1;\n',
				'src/billing/common/index.ts': "export { rate } from './rate';\n",
				'src/billing/common/utils/index.ts': "export { formatRate } from './formatRate';\n",
				'src/billing/common/utils/formatRate.ts': 'export const formatRate = () => 1;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		// the barrel rule owns the misplaced index.ts, so it is not also called flat
		expect(keysFor({ findings, rule: 'path-common-flat' })).toStrictEqual(['path-common-flat:src/billing/common/rate.ts']);
		expect(keysFor({ findings, rule: 'path-common-barrel' })).toStrictEqual([
			'path-common-barrel:src/billing/common/index.ts',
			'path-common-barrel:src/billing/common/utils/index.ts',
		]);
		expect(findings.find((finding) => finding.rule === 'path-common-barrel')?.severity).toBe('finding');
		expect(findings.find((finding) => finding.rule === 'path-common-flat')?.detail).toBe("'rate.ts' sits directly in src/billing/common");
	});

	test('reads a barrel in any source dialect, so a JS-only repo is judged at full strength', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'src/mod/common/index.mjs': "export { rate } from './rate';\n",
				'src/mod/common/rate.js': 'export const rate = 1;\n',
				'src/mod/common/utils/formatRate.js': 'export const formatRate = () => 1;\n',
				'src/mod/common/utils/index.jsx': "export { formatRate } from './formatRate';\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-common-barrel' })).toStrictEqual([
			'path-common-barrel:src/mod/common/index.mjs',
			'path-common-barrel:src/mod/common/utils/index.jsx',
		]);
		expect(keysFor({ findings, rule: 'path-common-flat' })).toStrictEqual(['path-common-flat:src/mod/common/rate.js']);
	});

	test('reports off-convention folder casing unless the directory has already settled its own', async () => {
		const { dir } = setupPathsRepo({
			files: {
				// three kebab siblings are a settled convention, which outranks the default
				'src/settled/a-one/x.ts': 'export const x = 1;\n',
				'src/settled/a-two/y.ts': 'export const y = 2;\n',
				'src/settled/a-three/z.ts': 'export const z = 3;\n',
				// here the convention is camelCase, so the odd ones out are flagged
				'src/mixed/alpha/a.ts': 'export const a = 1;\n',
				'src/mixed/beta/b.ts': 'export const b = 2;\n',
				'src/mixed/one-off/c.ts': 'export const c = 3;\n',
				'src/mixed/snake_folder/d.ts': 'export const d = 4;\n',
				'src/mixed/2fa/e.ts': 'export const e = 5;\n',
				// a folder graduated from one class keeps that class's PascalCase name
				'src/HttpClient/HttpClient.ts': 'export const HttpClient = 1;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual([
			'path-folder-casing:src/mixed/2fa',
			'path-folder-casing:src/mixed/one-off',
			'path-folder-casing:src/mixed/snake_folder',
		]);
		// two of the three resolution steps are judgment, so this is never blocking
		expect(findings.find((finding) => finding.rule === 'path-folder-casing')?.severity).toBe('advisory');
		expect(findings.find((finding) => finding.rule === 'path-folder-casing')?.detail).toBe("folder '2fa' is none of the three casings");
	});

	test('treats half the siblings as no convention at all — a settled directory needs more than half', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'src/tie/a-one/x.ts': 'export const x = 1;\n',
				'src/tie/b-two/y.ts': 'export const y = 2;\n',
				'src/tie/alpha/z.ts': 'export const z = 3;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		// each kebab folder has one kebab sibling out of two, which is a tie rather
		// than a convention, so the default still applies to both
		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual(['path-folder-casing:src/tie/a-one', 'path-folder-casing:src/tie/b-two']);
	});

	test('never judges the casing of a folder name a tool mandates, whatever its siblings do', async () => {
		const { dir } = setupPathsRepo({
			files: {
				// Jest's own shape: `__mocks__` and `__tests__` read as snake_case and
				// are a framework mandate, which is resolution step 2
				'src/feature/__mocks__/logger.ts': 'export const logger = 1;\n',
				'src/feature/__tests__/Thing.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				'src/feature/alpha/a.ts': 'export const a = 2;\n',
				'src/feature/one-off/b.ts': 'export const b = 3;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-folder-casing' })).toStrictEqual(['path-folder-casing:src/feature/one-off']);
	});

	test('reports a graduated domain folder holding one file, counting only the non-test ones', async () => {
		const { dir } = setupPathsRepo({
			files: {
				'src/billing/common/formatting/formatDate.ts': 'export const formatDate = () => 1;\n',
				// two related functions is exactly what graduation is for
				'src/billing/common/parsing/parseDate.ts': 'export const parseDate = () => 2;\n',
				'src/billing/common/parsing/parseTime.ts': 'export const parseTime = () => 3;\n',
				// a type folder is the always-built skeleton, never a graduation
				'src/billing/common/utils/formatTax.ts': 'export const formatTax = () => 4;\n',
				// the test beside it does not make a second file
				'src/billing/common/validation/validateEmail.ts': 'export const validateEmail = () => 5;\n',
				'src/billing/common/validation/validateEmail.unit.test.ts': "import { validateEmail } from './validateEmail';\n\ntest('runs', () => {\n\texpect(validateEmail()).toBe(5);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-domain-folder-single-file' })).toStrictEqual([
			'path-domain-folder-single-file:src/billing/common/formatting',
			'path-domain-folder-single-file:src/billing/common/validation',
		]);
		// the second file may be one commit away, so this is a prompt to look
		expect(findings.find((finding) => finding.rule === 'path-domain-folder-single-file')?.severity).toBe('advisory');
		expect(findings.find((finding) => finding.rule === 'path-domain-folder-single-file')?.detail).toBe("domain folder 'formatting' holds one file");
	});
});
