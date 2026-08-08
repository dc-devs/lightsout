import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

const setupTestPathsRepo = ({ files }: { files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-test-paths-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return { dir };
};

const keysFor = ({ findings, rule }: { findings: Array<{ rule: string; siteKey: string }>; rule: string }) =>
	findings.filter((finding) => finding.rule === rule).map((finding) => finding.siteKey);

describe('checkPathsAndNames test-path rules', () => {
	test('flags a unit test in a tests directory under src/, and leaves the package tests/ directory alone', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				'src/auth/AuthService.ts': 'export const AuthService = 1;\n',
				'src/auth/AuthService.unit.test.ts': "import { AuthService } from './AuthService';\n\ntest('runs', () => {\n\texpect(AuthService).toBe(1);\n});\n",
				'src/auth/__tests__/Legacy.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// a package's own tests/ directory is a sanctioned test-support location
				'tests/helpers/seedRepo.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-in-tests-folder' })).toStrictEqual(['path-test-in-tests-folder:src/auth/__tests__/Legacy.unit.test.ts']);
		expect(findings.find((finding) => finding.rule === 'path-test-in-tests-folder')?.severity).toBe('finding');
		expect(findings.find((finding) => finding.rule === 'path-test-in-tests-folder')?.detail).toBe('a unit test in src/auth/__tests__');
	});

	test('reads a plain tests/ or test/ directory under src/ exactly like a __tests__ one', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				'src/pay/runPayment.ts': 'export const runPayment = () => 1;\n',
				'src/pay/tests/runPayment.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				'src/pay/test/runPayment.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		// all three names come from the doc's own list, so a repo cannot dodge the
		// rule by dropping the underscores or the plural
		expect(keysFor({ findings, rule: 'path-test-in-tests-folder' })).toStrictEqual([
			'path-test-in-tests-folder:src/pay/test/runPayment.unit.test.ts',
			'path-test-in-tests-folder:src/pay/tests/runPayment.unit.test.ts',
		]);
		expect(findings.find((finding) => finding.rule === 'path-test-in-tests-folder')?.detail).toBe('a unit test in src/pay/test');
	});

	test('flags a test whose first name segment names no sibling source file, in any source dialect', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				'src/auth/AuthService.ts': 'export const AuthService = 1;\n',
				'src/auth/AuthService.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// a scenario suite qualifies the name; the first segment still names a real file
				'src/auth/runPipeline.ts': 'export const runPipeline = () => 1;\n',
				'src/auth/runPipeline.monorepo.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				'src/auth/Ghost.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// a JS subject satisfies co-location exactly like a TypeScript one
				'src/calc/add.js': 'export const add = () => 1;\n',
				'src/calc/add.unit.test.js': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-not-colocated' })).toStrictEqual(['path-test-not-colocated:src/auth/Ghost.unit.test.ts']);
		expect(findings.find((finding) => finding.rule === 'path-test-not-colocated')?.severity).toBe('finding');
		expect(findings.find((finding) => finding.rule === 'path-test-not-colocated')?.detail).toBe("no source file named 'Ghost' in src/auth");
	});

	test('flags shared test support under src/, sparing the co-located __mocks__ and the folder another rule owns', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				'src/auth/fixtures/user.ts': 'export const user = 1;\n',
				'src/auth/mocks/logger.ts': 'export const logger = 2;\n',
				// line 60 and line 138 both sanction a co-located __mocks__/
				'src/auth/__mocks__/logger.ts': 'export const logger = 3;\n',
				// helpers/ is a banned module name, and that rule owns it
				'src/auth/helpers/build.ts': 'export const build = () => 4;\n',
				// outside src/ these names ARE the sanctioned locations
				'tests/fixtures/user.ts': 'export const user = 5;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-support-in-src' })).toStrictEqual([
			'path-test-support-in-src:src/auth/fixtures',
			'path-test-support-in-src:src/auth/mocks',
		]);
		// one misplaced folder, one finding — helpers/ reports under its own rule
		expect(keysFor({ findings, rule: 'path-banned-module-name' })).toStrictEqual(['path-banned-module-name:src/auth/helpers']);
	});

	test('names the whole test-support list, and reports one finding per folder rather than per file', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				// two files in one misplaced folder — the folder is what gets moved
				'src/auth/fixtures/user.ts': 'export const user = 1;\n',
				'src/auth/fixtures/order.ts': 'export const order = 2;\n',
				'src/auth/testUtils/build.ts': 'export const build = () => 3;\n',
				'src/auth/test-utils/make.ts': 'export const make = () => 4;\n',
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-support-in-src' })).toStrictEqual([
			'path-test-support-in-src:src/auth/fixtures',
			'path-test-support-in-src:src/auth/test-utils',
			'path-test-support-in-src:src/auth/testUtils',
		]);
		expect(findings.find((finding) => finding.rule === 'path-test-support-in-src')?.detail).toBe("test-support folder 'fixtures' under src/");
	});

	test("reports a test whose subject its module's barrel does not export, matching on the resolved path", async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				// an ALIASED re-export: the exported name differs, the target file does not
				'src/pay/index.ts': "export { runPayment as pay } from './runPayment';\n",
				'src/pay/runPayment.ts': 'export const runPayment = () => 1;\n',
				'src/pay/runPayment.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				'src/pay/normalizeAmount.ts': 'export const normalizeAmount = () => 2;\n',
				'src/pay/normalizeAmount.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// a root-layer common/ is a boundary the doc names outright, and has no barrel by design
				'src/common/utils/formatDate.ts': 'export const formatDate = () => 3;\n',
				'src/common/utils/formatDate.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// no ancestor module at all means no boundary to be promoted through
				'src/loose/getThing.ts': 'export const getThing = () => 4;\n',
				'src/loose/getThing.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-untested-subject-not-public' })).toStrictEqual([
			'path-test-untested-subject-not-public:src/pay/normalizeAmount.unit.test.ts',
		]);
		// the doc offers two legitimate remedies, so this is a judgment call
		expect(findings.find((finding) => finding.rule === 'path-test-untested-subject-not-public')?.severity).toBe('advisory');
		expect(findings.find((finding) => finding.rule === 'path-test-untested-subject-not-public')?.detail).toBe(
			"'normalizeAmount.ts' is not re-exported from src/pay/index.ts",
		);
	});

	test('counts a subject reached by an `export *` line as public, which carries no names to match', async () => {
		const { dir } = setupTestPathsRepo({
			files: {
				'src/ship/index.ts': "export * from './sendShipment';\n",
				'src/ship/sendShipment.ts': 'export const sendShipment = () => 1;\n',
				'src/ship/sendShipment.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
				// left out of the barrel, which is what gives src/ship a boundary at all
				'src/ship/buildLabel.ts': 'export const buildLabel = () => 2;\n',
				'src/ship/buildLabel.unit.test.ts': "test('runs', () => {\n\texpect(1).toBe(1);\n});\n",
			},
		});

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

		expect(keysFor({ findings, rule: 'path-test-untested-subject-not-public' })).toStrictEqual([
			'path-test-untested-subject-not-public:src/ship/buildLabel.unit.test.ts',
		]);
		expect(findings.find((finding) => finding.rule === 'path-test-untested-subject-not-public')?.detail).toBe(
			"'buildLabel.ts' is not re-exported from src/ship/index.ts",
		);
	});
});
