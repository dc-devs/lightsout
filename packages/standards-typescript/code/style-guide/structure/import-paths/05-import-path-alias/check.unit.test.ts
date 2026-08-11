import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/**
 * A repo as the engine hands it to a file-text rule. The tsconfig rides in the
 * contents map beside the source files, exactly as the engine adds it — pass
 * `tsconfig: null` for a repo that has none.
 */
const setupFileTextInput = ({
	contents,
	tsconfig = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
}: {
	contents: Array<[string, string]>;
	tsconfig?: string | null;
}): StandardsCheckInput => {
	const files = contents.map(([path]) => path);
	const entries: Array<[string, string]> = tsconfig === null ? contents : [...contents, ['tsconfig.json', tsconfig]];

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files,
		tests: [],
		files,
		referenceFiles: [],
		contents: new Map(entries),
		standardsPackages: [],
	};
};

describe('import-path-alias check', () => {
	test('asks for file text, since the verdict reads both the tsconfig and each file’s import lines', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a relative import in a repo whose tsconfig configures aliases', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/getChargeLabel.ts', "import { formatRate } from '../common/utils/formatRate';"],
				['src/common/utils/formatRate.ts', "export const formatRate = (): string => '1';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-path-alias:src/billing/getChargeLabel.ts',
				files: [{ path: 'src/billing/getChargeLabel.ts' }],
				detail: "'../common/utils/formatRate' is imported by relative path",
				guidance: "Import through the package's configured alias — read `tsconfig.json` → `compilerOptions.paths` for the right one.",
			},
		]);
	});

	test('names every relative specifier of one file, the wrapped import form included', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/billing/getChargeLabel.ts',
					['import {', '\tformatRate,', "} from '../common/utils/formatRate';", "import { roundAmount } from './roundAmount';"].join('\n'),
				],
				['src/billing/roundAmount.ts', 'export const roundAmount = (): number => 1;'],
				['src/common/utils/formatRate.ts', "export const formatRate = (): string => '1';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-path-alias:src/billing/getChargeLabel.ts',
				files: [{ path: 'src/billing/getChargeLabel.ts' }],
				detail: "'../common/utils/formatRate', './roundAmount' are imported by relative path",
				guidance: "Import through the package's configured alias — read `tsconfig.json` → `compilerOptions.paths` for the right one.",
			},
		]);
	});

	test('counts a side-effect import, which names no bindings at all', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/app/main.ts', "import './registerHandlers';"],
				['src/app/registerHandlers.ts', 'export const registerHandlers = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-path-alias:src/app/main.ts',
				files: [{ path: 'src/app/main.ts' }],
				detail: "'./registerHandlers' is imported by relative path",
				guidance: "Import through the package's configured alias — read `tsconfig.json` → `compilerOptions.paths` for the right one.",
			},
		]);
	});

	test('an alias import earns nothing — it is the very form the rule asks for', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/getChargeLabel.ts', "import { formatRate } from '@/common/utils/formatRate';"],
				['src/common/utils/formatRate.ts', "export const formatRate = (): string => '1';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ repo: 'declares no aliases', tsconfig: '{ "compilerOptions": { "strict": true } }' },
		{ repo: 'ships no tsconfig at all', tsconfig: null },
	])('stays silent in a repo that $repo, where relative paths are the documented form', async ({ tsconfig }) => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/getChargeLabel.ts', "import { formatRate } from '../common/utils/formatRate';"],
				['src/common/utils/formatRate.ts', "export const formatRate = (): string => '1';"],
			],
			tsconfig,
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a relative specifier that resolves to nothing in scope — an asset an alias cannot answer for', async () => {
		const input = setupFileTextInput({
			contents: [['src/app/main.ts', ["import './styles.css';", "import logo from './logo.svg';"].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('judges only files inside a src tree, which is what the aliases are configured to reach', async () => {
		const input = setupFileTextInput({
			contents: [
				['scripts/build.ts', "import { readVersion } from './readVersion';"],
				['scripts/readVersion.ts', "export const readVersion = (): string => '1';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
