import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { buildUnconsumedExportCheck } from './buildUnconsumedExportCheck.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text. */
const setupFileTextInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files.filter((path) => !path.includes('.test.')),
		tests: files.filter((path) => path.includes('.test.')),
		files,
		referenceFiles: [],
		contents: new Map(contents),
	};
};

/** The input a rule that did NOT declare `file-text` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({ kind: StandardsInputKind.CloneSpans, cwd: '/repo', source: ['src/ingestRecords.ts'], spans: [] });

/** A repo whose only export is published by a barrel and mentioned nowhere else. */
const setupBarrelOnlyRepo = () =>
	setupFileTextInput({
		contents: [
			['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
			['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
		],
	});

const setupCheck = ({ matches }: { matches: Parameters<typeof buildUnconsumedExportCheck>[0]['matches'] }) =>
	buildUnconsumedExportCheck({ rule: 'barrel-only-export', matches, detail: 'exported through a barrel but no module consumes it', guidance: 'Deliberate public API, or dead?' });

describe('buildUnconsumedExportCheck', () => {
	test('declares the file-text input its rules read, since the verdict counts mentions across the repo', () => {
		expect(setupCheck({ matches: ({ barrel }) => barrel }).inputKind).toBe('file-text');
	});

	test('reports the exports whose verdict the rule claims, in the wording the rule gave', async () => {
		const findings = await setupCheck({ matches: ({ barrel, test: byTest }) => barrel && !byTest }).run({ input: setupBarrelOnlyRepo(), settings: {} });

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
		const findings = await setupCheck({ matches: ({ barrel, test: byTest }) => byTest && !barrel }).run({ input: setupBarrelOnlyRepo(), settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('returns nothing for an input of any other kind rather than refusing', async () => {
		const findings = await setupCheck({ matches: () => true }).run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
