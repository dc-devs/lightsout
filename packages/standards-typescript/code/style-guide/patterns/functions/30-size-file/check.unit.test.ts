import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** The caps this suite measures against — small enough that a fixture stays readable, and far enough apart that the two extensions cannot be confused. */
const caps = { file: 6, tsxFile: 9 };

/** A file spanning exactly `lines` lines, its body statements nothing else depends on and no terminating newline. */
const buildSource = ({ lines }: { lines: number }) => Array.from({ length: lines }, (_, index) => `export const step${index} = ${index};`).join('\n');

describe('size-file check', () => {
	test('rides the parsed trees the other size rules already paid for, rather than asking for the text a second time', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a file past its cap, naming the path, its length and the number it was measured against', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', buildSource({ lines: 7 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([
			{
				siteKey: 'size-file:src/reporting/buildReportSummary.ts',
				files: [{ path: 'src/reporting/buildReportSummary.ts' }],
				detail: '7 lines (cap ~6)',
				guidance: 'Split the file, or graduate the concept it has grown into.',
			},
		]);
	});

	test('leaves a file measured to exactly its cap — the cap is the last allowed line, not the first banned one', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', buildSource({ lines: 6 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('a .tsx earns the roomier cap, so a file too long for a .ts still passes', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/ReportPanel.tsx', buildSource({ lines: 9 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('reports a .tsx past the .tsx cap against that roomier number', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/ReportPanel.tsx', buildSource({ lines: 10 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([
			{
				siteKey: 'size-file:src/reporting/ReportPanel.tsx',
				files: [{ path: 'src/reporting/ReportPanel.tsx' }],
				detail: '10 lines (cap ~9)',
				guidance: 'Split the file, or graduate the concept it has grown into.',
			},
		]);
	});

	test('a barrel is exempt at any length, since a public API cannot take the split the finding would ask for', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/index.ts', buildSource({ lines: 40 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('the exemption reads the file name, not the path, so a barrel deep in the tree is exempt too', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/common/utils/index.ts', buildSource({ lines: 40 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('only the name index.ts is exempt — a file merely holding it is measured like any other', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/indexes.ts', buildSource({ lines: 7 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['size-file:src/reporting/indexes.ts']);
	});

	test('the empty line a terminating newline leaves behind counts, exactly as the line count it replaces did', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', `${buildSource({ lines: 6 })}\n`]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe('7 lines (cap ~6)');
	});

	test('each oversized file is its own job, and the files within their caps are passed over', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/reporting/buildReportRows.ts', buildSource({ lines: 4 })],
				['src/reporting/buildReportSummary.ts', buildSource({ lines: 7 })],
				['src/reporting/ReportPanel.tsx', buildSource({ lines: 12 })],
			],
		});

		const findings = await check.run({ input, settings: caps });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['size-file:src/reporting/buildReportSummary.ts', 'size-file:src/reporting/ReportPanel.tsx']);
	});

	test('reports nothing for a repo with no source files rather than refusing', async () => {
		const input = setupSyntaxTreeInput({ sources: [] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: caps });

		expect(findings).toStrictEqual([]);
	});
});
