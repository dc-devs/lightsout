import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A module whose barrel publishes `renderFeature` and keeps `getLabel` and `separator` to itself. */
const setupFeature = ({ barrel, tests }: { barrel: string; tests: string[] }) =>
	setupFileTextInput({
		contents: [
			['src/feature/index.ts', barrel],
			['src/feature/renderFeature.ts', 'export const renderFeature = (): string => "feature";'],
			['src/feature/getLabel.ts', 'export const getLabel = (): string => "label";'],
			['src/feature/separator.ts', 'export const separator = " — ";'],
		],
		tests,
	});

/** The same feature with a nested module of its own, so a subject has two barrels above it. */
const setupNestedFeature = ({ barrel }: { barrel: string }) =>
	setupFileTextInput({
		contents: [
			['src/feature/index.ts', barrel],
			['src/feature/renderFeature.ts', 'export const renderFeature = (): string => "feature";'],
			['src/feature/getLabel.ts', 'export const getLabel = (): string => "label";'],
			['src/feature/parsing/index.ts', "export { parseRow } from './parseRow';"],
			['src/feature/parsing/parseRow.ts', 'export const parseRow = (): string => "row";'],
			['src/feature/parsing/parseValue.ts', 'export const parseValue = (): string => "value";'],
		],
		tests: ['src/feature/parsing/parseValue.unit.test.ts'],
	});

describe('path-test-untested-subject-not-public check', () => {
	test('asks for file text, since the verdict is read from what a barrel re-exports', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a direct test of an internal, naming both the test and the barrel the promotion would edit', async () => {
		const input = setupFeature({ barrel: "export { renderFeature } from './renderFeature';", tests: ['src/feature/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-test-untested-subject-not-public:src/feature/getLabel.unit.test.ts|src/feature/index.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts' }, { path: 'src/feature/index.ts' }],
				detail: "'getLabel.ts' is not re-exported from src/feature/index.ts",
				guidance:
					"A direct test is a promotion, not an exception: add the subject to its module's barrel, or drive its coverage through the module's boundary instead. Existing ones are migration debt to leave in place — judge before acting.",
			},
		]);
	});

	test('leaves a test alone once its subject is in the barrel, which is the promotion the rule asks for', async () => {
		const input = setupFeature({
			barrel: "export { renderFeature } from './renderFeature';\nexport { getLabel } from './getLabel';",
			tests: ['src/feature/getLabel.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ layer: 'directly under src', subject: 'src/common/utils/parseId.ts', file: 'src/common/utils/parseId.unit.test.ts' },
		{ layer: 'under a layer beneath src', subject: 'src/app/common/formatName.ts', file: 'src/app/common/formatName.unit.test.ts' },
	])('leaves a subject in a root-layer common/ $layer alone, which the document calls a boundary outright', async ({ subject, file }) => {
		const input = setupFileTextInput({
			contents: [
				['src/app/index.ts', "export { renderApp } from './renderApp';"],
				['src/app/renderApp.ts', 'export const renderApp = (): string => "app";'],
				[subject, 'export const value = (): string => "value";'],
			],
			tests: [file],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent where no barrel sits above the subject — an absent module is not a missing export', async () => {
		const input = setupFileTextInput({
			contents: [['src/feature/getLabel.ts', 'export const getLabel = (): string => "label";']],
			tests: ['src/feature/getLabel.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names the nearest owning barrel when modules nest, since that is the one the subject belongs to', async () => {
		const input = setupNestedFeature({ barrel: "export { renderFeature } from './renderFeature';" });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ files }) => files.map(({ path }) => path))).toStrictEqual([
			['src/feature/parsing/parseValue.unit.test.ts', 'src/feature/parsing/index.ts'],
		]);
	});

	test('stays silent when an outer barrel publishes the subject the nearest one omits — it is public either way', async () => {
		const input = setupNestedFeature({
			barrel: "export { renderFeature } from './renderFeature';\nexport { parseValue } from './parsing/parseValue';",
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("judges only tests inside a package's source tree, never its own tests/ tree", async () => {
		const input = setupFeature({ barrel: "export { renderFeature } from './renderFeature';", tests: ['tests/unit/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent for a test naming no source file beside it, which is another rule’s verdict', async () => {
		const input = setupFeature({ barrel: "export { renderFeature } from './renderFeature';", tests: ['src/feature/labelling.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
