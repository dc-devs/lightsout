import { expect, describe, test, jest } from '@jest/globals';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { printFindingGroups } from '@/cli/common/render/printFindingGroups';

const finding = (overrides: Partial<ScanFinding> = {}): ScanFinding => ({
	detector: ScanDetector.Size,
	severity: ScanSeverity.Advisory,
	cluster: 'size:one',
	files: [{ path: 'src/a.ts', startLine: 10, endLine: 90 }],
	detail: "function 'one' is 81 lines (cap ~80)",
	...overrides,
});

// The renderer's whole output IS its console.log lines. isTTY is pinned off so
// the paint helpers stay no-ops and the assertions read plain text.
const setupPrinter = () => {
	const logged: string[] = [];

	process.stdout.isTTY = false;
	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return { logged, textOf: () => logged.join('\n') };
};

describe('printFindingGroups', () => {
	test('heads each detector with its severity and count', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding(), finding({ cluster: 'size:two' })] });

		expect(logged).toContain('ℹ size · 2 advisories');
	});

	test('says finding, singular, for one item of work', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding({ severity: ScanSeverity.Finding, detector: ScanDetector.Clone })] });

		expect(logged).toContain('⚠ clone · 1 finding');
	});

	test('splits one detector by severity, because a size finding and a size advisory are not one tally', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [finding({ severity: ScanSeverity.Finding, detail: '300 lines (cap ~250)' }), finding({ cluster: 'size:two' })],
		});

		// `size` reports an oversized file as work and an oversized function as advice
		expect(logged).toContain('⚠ size · 1 finding');
		expect(logged).toContain('ℹ size · 1 advisory');
	});

	test('aligns the single-site rows in a group so their measurements can be compared', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ files: [{ path: 'src/short.ts', startLine: 1, endLine: 90 }], detail: '90 lines' }),
				finding({ cluster: 'size:two', files: [{ path: 'src/a/much/longer/path.ts', startLine: 1, endLine: 99 }], detail: '99 lines' }),
			],
		});

		const rows = logged.filter((line) => line.includes('lines'));

		expect(rows.map((row) => row.indexOf('lines'))).toStrictEqual([rows[1]?.indexOf('lines') ?? -1, rows[1]?.indexOf('lines') ?? -1]);
	});

	test('prints the shared guidance once beneath the rows it covers', () => {
		const { logged, textOf } = setupPrinter();

		printFindingGroups({
			findings: [finding({ guidance: 'Extract logic.' }), finding({ cluster: 'size:two', guidance: 'Extract logic.' })],
		});

		expect(logged.filter((line) => line.includes('Extract logic.')).length).toBe(1);
		// and it comes after the rows, not before them
		expect(textOf().indexOf('Extract logic.')).toBeGreaterThan(textOf().indexOf("function 'one'"));
	});

	test('keeps two kinds of guidance with their own rows rather than merging them', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ detector: ScanDetector.DeadExport, detail: "'a' is referenced nowhere else", guidance: 'Delete it.' }),
				finding({ detector: ScanDetector.DeadExport, cluster: 'dead:b', detail: "'b' is referenced only by tests", guidance: 'Production-dead.' }),
			],
		});

		expect(logged.filter((line) => line.includes('Delete it.')).length).toBe(1);
		expect(logged.filter((line) => line.includes('Production-dead.')).length).toBe(1);
	});

	test('a finding spanning several files lists them, then puts the detail underneath', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({
					detector: ScanDetector.Clone,
					files: [{ path: 'src/a.ts', startLine: 1, endLine: 60 }, { path: 'src/b.ts', startLine: 5, endLine: 64 }],
					detail: '60-line duplicated span',
				}),
			],
		});

		// there is no single location to align a multi-site row on
		expect(logged).toContain('    src/a.ts:1-60');
		expect(logged).toContain('    src/b.ts:5-64');
		expect(logged.some((line) => line.trim() === '60-line duplicated span')).toBe(true);
	});

	test('renders a location with no line number as a bare path', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding({ files: [{ path: 'src/a.ts' }], detail: 'dead' })] });

		expect(logged.some((line) => line.includes('src/a.ts') && !line.includes(':'))).toBe(true);
	});

	test('prints nothing at all when there is nothing to report', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [] });

		expect(logged).toStrictEqual([]);
	});

	test('pluralises the count, because one finding and four read differently', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ severity: ScanSeverity.Finding, detector: ScanDetector.Clone }),
				finding({ severity: ScanSeverity.Finding, detector: ScanDetector.Clone, cluster: 'clone:two' }),
			],
		});

		expect(logged).toContain('⚠ clone · 2 findings');
	});

	test('a single-line span is rendered as one number, not a range onto itself', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding({ files: [{ path: 'src/a.ts', startLine: 12, endLine: 12 }], detail: 'one line' })] });

		expect(logged.some((line) => line.includes('src/a.ts:12') && !line.includes('12-12'))).toBe(true);
	});
});
