import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { buildUnconsumedExportCheck } from './buildUnconsumedExportCheck.ts';

/** A repo whose only export is published by a barrel and mentioned nowhere else. */
const setupBarrelOnlyRepo = () =>
	setupFileTextInput({
		contents: [
			['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
			['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
		],
	});

const buildCheck = ({ matches }: { matches: Parameters<typeof buildUnconsumedExportCheck>[0]['matches'] }) =>
	buildUnconsumedExportCheck({
		rule: 'barrel-only-export',
		matches,
		detail: 'exported through a barrel but no module consumes it',
		guidance: 'Deliberate public API, or dead?',
	});

describe('buildUnconsumedExportCheck', () => {
	test('declares the file-text input its rules read, since the verdict counts mentions across the repo', () => {
		expect(buildCheck({ matches: ({ barrel }) => barrel }).inputKind).toBe('file-text');
	});

	test('reports the exports whose verdict the rule claims, in the wording the rule gave', async () => {
		const findings = await buildCheck({ matches: ({ barrel, test: byTest }) => barrel && !byTest }).run({ input: setupBarrelOnlyRepo(), settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-only-export:src/ingestion/ingestRecords.ts',
				files: [{ path: 'src/ingestion/ingestRecords.ts' }],
				detail: "'ingestRecords' is exported through a barrel but no module consumes it",
				guidance: 'Deliberate public API, or dead?',
			},
		]);
	});

	test('claims nothing when the rule’s verdict does not match, so the verdicts stay mutually exclusive', async () => {
		// the same repo, read by the rule that wants test-and-not-barrel instead
		const findings = await buildCheck({ matches: ({ barrel, test: byTest }) => byTest && !barrel }).run({ input: setupBarrelOnlyRepo(), settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('inside a declared pack, a rule under tests/ declares an export the verdict can reach', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
			standardsPacks: ['standards'],
		});

		const findings = await buildCheck({ matches: ({ barrel, test: byTest }) => !barrel && !byTest }).run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-only-export:standards/tests/unit-testing/10-rule/check.ts',
				files: [{ path: 'standards/tests/unit-testing/10-rule/check.ts' }],
				detail: "'checkRule' is exported through a barrel but no module consumes it",
				guidance: 'Deliberate public API, or dead?',
			},
		]);
	});

	test('the same path with no pack declared above it is test code, whose own helpers are nobody’s public API', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
		});

		const findings = await buildCheck({ matches: ({ barrel, test: byTest }) => !barrel && !byTest }).run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('returns nothing for an input of any other kind rather than refusing', async () => {
		const findings = await buildCheck({ matches: () => true }).run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
