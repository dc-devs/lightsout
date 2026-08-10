import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@/contracts';
import { StandardsInputKind } from '@/contracts';
import { buildHookContentCheck } from './buildHookContentCheck.ts';

/** Test files as the engine hands them to a test-file rule. */
const setupTestFileInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => ({
	kind: StandardsInputKind.TestFile,
	cwd: '/repo',
	tests: contents.map(([path]) => path),
	contents: new Map(contents),
});

/** The input a rule that did NOT declare `test-file` would receive. */
const setupOtherKindInput = (): StandardsCheckInput => ({ kind: StandardsInputKind.CloneSpans, cwd: '/repo', source: ['src/subject.ts'], spans: [] });

const setupCheck = ({ hooks }: { hooks: string[] }) =>
	buildHookContentCheck({
		rule: 'test-assert-in-hook',
		hooks,
		pattern: /\bexpect\s*\(/,
		detailSuffix: 'asserts',
		guidance: 'Act and assert live in the `test`; a hook only arranges.',
	});

describe('buildHookContentCheck', () => {
	test('declares the test-file input its rules read', () => {
		expect(setupCheck({ hooks: ['beforeEach'] }).inputKind).toBe('test-file');
	});

	test('reports a hook whose body matches, naming the hook and the line it sits on', async () => {
		const input = setupTestFileInput({
			contents: [['src/profile.unit.test.ts', "describe('profile', () => {\n\tbeforeEach(() => {\n\t\texpect(subject).toBe(1);\n\t});\n});\n"]],
		});

		const findings = await setupCheck({ hooks: ['beforeEach'] }).run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/profile.unit.test.ts',
				files: [{ path: 'src/profile.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: 'beforeEach at line 2 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test('reads only the hooks the rule names, so another hook is left to the rule that names it', async () => {
		const input = setupTestFileInput({
			contents: [['src/profile.unit.test.ts', "describe('profile', () => {\n\tafterEach(() => {\n\t\texpect(subject).toBe(1);\n\t});\n});\n"]],
		});

		// the same assertion, in a hook this rule does not name
		const findings = await setupCheck({ hooks: ['beforeEach'] }).run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads every hook a rule names when it names several', async () => {
		const input = setupTestFileInput({
			contents: [['src/profile.unit.test.ts', "describe('profile', () => {\n\tafterEach(() => {\n\t\texpect(subject).toBe(1);\n\t});\n});\n"]],
		});

		const findings = await setupCheck({ hooks: ['beforeEach', 'afterEach'] }).run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/profile.unit.test.ts',
				files: [{ path: 'src/profile.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: 'afterEach at line 2 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test('a hook that does not match is silent', async () => {
		const input = setupTestFileInput({
			contents: [['src/profile.unit.test.ts', "describe('profile', () => {\n\tbeforeEach(() => {\n\t\tsubject = setup();\n\t});\n});\n"]],
		});

		const findings = await setupCheck({ hooks: ['beforeEach'] }).run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('returns nothing for an input of any other kind rather than refusing', async () => {
		const findings = await setupCheck({ hooks: ['beforeEach'] }).run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
