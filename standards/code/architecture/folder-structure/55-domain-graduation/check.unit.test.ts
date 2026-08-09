import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a path rule: every file in scope, plus the test files among them. */
const setupFileListInput = ({ files, tests = [] }: { files: string[]; tests?: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests,
	files,
	referenceFiles: [],
	dependencies: new Map(),
	standardsPackages: [],
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/common/utils/formatDate.ts'],
	spans: [],
});

describe('domain-graduation check', () => {
	test('asks for the file list alone, since the grouping is read from the file names', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports two utils siblings whose names lead with the same subject verb', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/utils/formatDate.ts', 'src/billing/common/utils/formatCurrency.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'domain-graduation:src/billing/common/utils/formatCurrency.ts|src/billing/common/utils/formatDate.ts',
				files: [{ path: 'src/billing/common/utils/formatDate.ts' }, { path: 'src/billing/common/utils/formatCurrency.ts' }],
				detail: "2 'format*' functions in src/billing/common/utils",
				guidance: 'A domain-folder graduation candidate. Heuristic — judge before acting.',
			},
		]);
	});

	test('leaves a lone function alone, since a domain folder graduates on the SECOND related function', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/formatDate.ts', 'src/billing/common/utils/parseDate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('counts every sibling in the group, so a third one is reported as three', async () => {
		const input = setupFileListInput({
			files: [
				'src/billing/common/utils/formatDate.ts',
				'src/billing/common/utils/formatCurrency.ts',
				'src/billing/common/utils/formatAddress.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["3 'format*' functions in src/billing/common/utils"]);
	});

	test('names every verb that only says how a value is reached, restated here so one dropped from the list stops suppressing loudly', async () => {
		const accessVerbs = [
			'is',
			'has',
			'can',
			'should',
			'was',
			'get',
			'set',
			'read',
			'write',
			'load',
			'save',
			'fetch',
			'list',
			'collect',
			'gather',
			'to',
			'as',
			'from',
			'with',
			'on',
			'create',
			'make',
			'new',
			'build',
			'init',
			'resolve',
			'find',
			'lookup',
			'run',
			'invoke',
			'call',
			'execute',
			'apply',
		];
		const input = setupFileListInput({
			files: accessVerbs.flatMap((verb) => [`src/${verb}/utils/${verb}Alpha.ts`, `src/${verb}/utils/${verb}Beta.ts`]),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads the leading word across camelCase, separators and casing, so one spelling of a verb is one group', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/utils/formatCurrency.ts', 'src/billing/common/utils/format_date.ts', 'src/billing/common/utils/FormatTime.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["3 'format*' functions in src/billing/common/utils"]);
	});

	test('never groups files whose names carry no leading word at all', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/.eslintrc.ts', 'src/billing/common/utils/.prettierrc.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('judges only what sits directly inside a utils/, since the same verb elsewhere is domain code already in place', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/formatting/formatDate.ts', 'src/billing/common/formatting/formatCurrency.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('never counts a test beside its subject, so a co-located test cannot make a group of one read as two', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/utils/formatDate.ts', 'src/billing/common/utils/formatDate.unit.test.ts'],
			tests: ['src/billing/common/utils/formatDate.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('groups within one folder alone, so the same verb in two utils/ folders is two lone functions', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/formatDate.ts', 'src/pay/common/utils/formatCurrency.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each verb group in a folder as its own finding', async () => {
		const input = setupFileListInput({
			files: [
				'src/billing/common/utils/formatDate.ts',
				'src/billing/common/utils/validateEmail.ts',
				'src/billing/common/utils/formatCurrency.ts',
				'src/billing/common/utils/validatePhone.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual([
			"2 'format*' functions in src/billing/common/utils",
			"2 'validate*' functions in src/billing/common/utils",
		]);
	});

	test('reports each utils/ folder separately, so every candidate carries its own site key', async () => {
		const input = setupFileListInput({
			files: [
				'src/pay/common/utils/formatDate.ts',
				'src/pay/common/utils/formatCurrency.ts',
				'src/bill/common/utils/validateEmail.ts',
				'src/bill/common/utils/validatePhone.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'domain-graduation:src/pay/common/utils/formatCurrency.ts|src/pay/common/utils/formatDate.ts',
			'domain-graduation:src/bill/common/utils/validateEmail.ts|src/bill/common/utils/validatePhone.ts',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
