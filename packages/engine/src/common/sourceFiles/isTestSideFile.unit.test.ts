import { expect, test } from '@jest/globals';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';

/** Paths `isTestFile` accepts, each with the standards packs it is judged against. */
const acceptedByIsTestFile = [
	{ path: 'tests/helpers/report.ts' },
	{ path: 'test/setup.ts' },
	{ path: 'src/common/__tests__/add.ts' },
	{ path: 'src/common/__mocks__/fs.ts' },
	{ path: 'packages/web/e2e/login.ts' },
	{ path: 'src/common/utils/packageOf.unit.test.ts' },
	{ path: 'src/app/App.spec.tsx' },
	// inside a standards pack, a real test still says so in its filename
	{ path: 'standards/common/utils/scanTestLines.unit.test.ts', standardsPacks: ['standards'] },
	{ path: 'standards/common/__mocks__/fs.ts', standardsPacks: ['standards'] },
];

test('isTestSideFile: snapshots and jest config files join the test files, and ordinary source stays out', () => {
	const answers = {
		snapshot: isTestSideFile({ path: 'src/app/__snapshots__/render.snap' }),
		snapshotBesideAPackage: isTestSideFile({ path: 'packages/web/src/Button.snap' }),
		rootJestConfig: isTestSideFile({ path: 'jest.config.ts' }),
		packageJestConfig: isTestSideFile({ path: 'packages/engine/jest.config.cjs' }),
		qualifiedJestConfig: isTestSideFile({ path: 'packages/web/jest.unit.config.js' }),
		esmJestConfig: isTestSideFile({ path: 'tooling/jest.config.mjs' }),
		testFile: isTestSideFile({ path: 'src/common/utils/packageOf.unit.test.ts' }),
		ordinarySource: isTestSideFile({ path: 'src/common/utils/runCommand.ts' }),
		ordinaryConfig: isTestSideFile({ path: 'src/common/utils/config.ts' }),
		unsupportedJestConfigExtension: isTestSideFile({ path: 'packages/web/jest.config.json' }),
		snapshotWord: isTestSideFile({ path: 'src/app/snapshot.ts' }),
	};

	expect(answers).toStrictEqual({
		snapshot: true,
		snapshotBesideAPackage: true,
		rootJestConfig: true,
		packageJestConfig: true,
		qualifiedJestConfig: true,
		esmJestConfig: true,
		testFile: true,
		ordinarySource: false,
		ordinaryConfig: false,
		unsupportedJestConfigExtension: false,
		snapshotWord: false,
	});
});

test('isTestSideFile: every path isTestFile accepts is test-side, standards packs included', () => {
	const testFileAnswers = acceptedByIsTestFile.map((params) => isTestFile(params));
	const testSideAnswers = acceptedByIsTestFile.map((params) => isTestSideFile(params));
	// a pack's own rule implementation is source, not test code — the packs argument has to reach isTestFile
	const packRuleSource = {
		testFile: isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts', standardsPacks: ['standards'] }),
		testSide: isTestSideFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts', standardsPacks: ['standards'] }),
		withoutPacks: isTestSideFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts' }),
	};

	expect(testFileAnswers).toStrictEqual([true, true, true, true, true, true, true, true, true]);
	expect(testSideAnswers).toStrictEqual([true, true, true, true, true, true, true, true, true]);
	expect(packRuleSource).toStrictEqual({ testFile: false, testSide: false, withoutPacks: true });
});
