import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { printFindingGroups } from '@/cli/common/render/printFindingGroups';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.SizeFunction,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
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
	test('heads each rule with its severity and count', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding(), finding({ siteKey: 'size:two' })] });

		expect(logged).toContain('ℹ size-function · 2 advisories');
	});

	test('names the severity, not a noun, for a blocking group', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding({ severity: StandardsSeverity.Blocking, rule: StandardsRule.Clone })] });

		expect(logged).toContain('⚠ clone · 1 blocking');
	});

	test('splits one rule by severity, because a size violation and a size advisory are not one tally', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [finding({ severity: StandardsSeverity.Blocking, detail: '300 lines (cap ~250)' }), finding({ siteKey: 'size:two' })],
		});

		// `size` reports an oversized file as work and an oversized function as advice
		expect(logged).toContain('⚠ size-function · 1 blocking');
		expect(logged).toContain('ℹ size-function · 1 advisory');
	});

	test('aligns the single-site rows in a group so their measurements can be compared', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ files: [{ path: 'src/short.ts', startLine: 1, endLine: 90 }], detail: '90 lines' }),
				finding({ siteKey: 'size:two', files: [{ path: 'src/a/much/longer/path.ts', startLine: 1, endLine: 99 }], detail: '99 lines' }),
			],
		});

		const rows = logged.filter((line) => line.includes('lines'));

		expect(rows.map((row) => row.indexOf('lines'))).toStrictEqual([rows[1]?.indexOf('lines') ?? -1, rows[1]?.indexOf('lines') ?? -1]);
	});

	test('a location too wide for the column drops its detail to the next line rather than pushing the column out', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({
					files: [{ path: 'src/features/onboarding/common/utils/buildInitialChecklist.ts', startLine: 1, endLine: 300 }],
					detail: '300 lines (cap ~250)',
				}),
			],
		});

		expect(logged).toContain('    src/features/onboarding/common/utils/buildInitialChecklist.ts:1-300');
		expect(logged).toContain('      300 lines (cap ~250)');
	});

	test('prints the shared guidance once beneath the rows it covers', () => {
		const { logged, textOf } = setupPrinter();

		printFindingGroups({
			findings: [finding({ guidance: 'Extract logic.' }), finding({ siteKey: 'size:two', guidance: 'Extract logic.' })],
		});

		expect(logged.filter((line) => line.includes('Extract logic.')).length).toBe(1);
		// and it comes after the rows, not before them
		expect(textOf().indexOf('Extract logic.')).toBeGreaterThan(textOf().indexOf("function 'one'"));
	});

	test('keeps two kinds of guidance with their own rows rather than merging them', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ rule: StandardsRule.DeadExport, detail: "'a' is referenced nowhere else", guidance: 'Delete it.' }),
				finding({ rule: StandardsRule.DeadExport, siteKey: 'dead:b', detail: "'b' is referenced only by tests", guidance: 'Production-dead.' }),
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
					rule: StandardsRule.Clone,
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

	test('pluralises the advisory count but not the blocking one, because only one of the two words has a plural', () => {
		const { logged } = setupPrinter();

		printFindingGroups({
			findings: [
				finding({ severity: StandardsSeverity.Blocking, rule: StandardsRule.Clone }),
				finding({ severity: StandardsSeverity.Blocking, rule: StandardsRule.Clone, siteKey: 'clone:two' }),
				finding({ siteKey: 'size:one' }),
				finding({ siteKey: 'size:two' }),
			],
		});

		// `blocking` is the severity's name, so it reads the same at any count
		expect(logged).toContain('⚠ clone · 2 blocking');
		expect(logged).toContain('ℹ size-function · 2 advisories');
	});

	test('a single-line span is rendered as one number, not a range onto itself', () => {
		const { logged } = setupPrinter();

		printFindingGroups({ findings: [finding({ files: [{ path: 'src/a.ts', startLine: 12, endLine: 12 }], detail: 'one line' })] });

		expect(logged.some((line) => line.includes('src/a.ts:12') && !line.includes('12-12'))).toBe(true);
	});
});
