import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { buildUnconsumedExportCheck } from './buildUnconsumedExportCheck.ts';

/** A repo whose only export is mentioned by nothing but a folder barrel — which is no use of it. */
const setupUnusedRepo = () =>
	setupFileTextInput({
		contents: [
			['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
			['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
		],
	});

const buildCheck = ({ matches }: { matches: Parameters<typeof buildUnconsumedExportCheck>[0]['matches'] }) =>
	buildUnconsumedExportCheck({
		rule: 'dead-export',
		matches,
		detail: 'referenced nowhere else',
		guidance: 'Delete it?',
	});

describe('buildUnconsumedExportCheck', () => {
	test('declares the file-text input its rules read, since the verdict counts mentions across the repo', () => {
		expect(buildCheck({ matches: ({ test: byTest }) => !byTest }).inputKind).toBe('file-text');
	});

	test('reports the exports whose verdict the rule claims, in the wording the rule gave', async () => {
		const findings = await buildCheck({ matches: ({ test: byTest }) => !byTest }).run({ input: setupUnusedRepo(), settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/ingestion/ingestRecords.ts',
				files: [{ path: 'src/ingestion/ingestRecords.ts' }],
				detail: "'ingestRecords' is referenced nowhere else",
				guidance: 'Delete it?',
			},
		]);
	});

	test('claims nothing when the rule’s verdict does not match, so the verdicts stay mutually exclusive', async () => {
		// the same repo, read by the rule that wants a test mention instead
		const findings = await buildCheck({ matches: ({ test: byTest }) => byTest }).run({ input: setupUnusedRepo(), settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('inside a declared pack, a rule under tests/ declares an export the verdict can reach', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
			standardsPacks: ['standards'],
		});

		const findings = await buildCheck({ matches: ({ test: byTest }) => !byTest }).run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:standards/tests/unit-testing/10-rule/check.ts',
				files: [{ path: 'standards/tests/unit-testing/10-rule/check.ts' }],
				detail: "'checkRule' is referenced nowhere else",
				guidance: 'Delete it?',
			},
		]);
	});

	test('the same path with no pack declared above it is test code, whose own helpers are nobody’s public API', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
		});

		const findings = await buildCheck({ matches: ({ test: byTest }) => !byTest }).run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('returns nothing for an input of any other kind rather than refusing', async () => {
		const findings = await buildCheck({ matches: () => true }).run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('derives the framework carve-outs from the manifests in scope, so a route file consuming a screen is its consumer', async () => {
		const input = setupFileTextInput({
			contents: [
				['package.json', '{ "dependencies": { "@tanstack/react-start": "1.0.0" } }'],
				['src/routes/index.tsx', "import { RunsIndex } from '../features/app/screens/RunsIndex';\n\nexport const Route = { component: RunsIndex };"],
				['src/features/app/screens/RunsIndex/index.ts', "export { RunsIndex } from './RunsIndex';"],
				['src/features/app/screens/RunsIndex/RunsIndex.tsx', 'export const RunsIndex = (): null => null;'],
			],
		});

		const findings = await buildCheck({ matches: ({ test: byTest }) => !byTest }).run({ input, settings: {} });

		// with no carve-out derived, that route file reads as a barrel and the
		// screen it renders as used by nobody
		expect(findings).toStrictEqual([]);
	});
});
