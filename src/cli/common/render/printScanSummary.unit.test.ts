import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { printScanSummary } from '@/cli/common/render/printScanSummary';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.Size,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const setupPrinter = () => {
	const logged: string[] = [];

	process.stdout.isTTY = false;
	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return { logged };
};

const cellsOf = ({ logged }: { logged: string[] }) =>
	logged.filter((line) => line.startsWith('│')).map((line) => line.split('│').slice(1, -1).map((cell) => cell.trim()));

describe('printScanSummary', () => {
	test('counts findings and advisories in separate columns', () => {
		const { logged } = setupPrinter();

		printScanSummary({
			findings: [
				finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Finding }),
				finding(),
				finding({ siteKey: 'size:two' }),
			],
			reportPath: '.lightsout/scan.json',
		});

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'findings', 'advisories'],
			['module-boundary', '1', '—'],
			['size', '—', '2'],
			['total', '1', '2'],
		]);
	});

	test('a repo carrying only advisories reports zero findings rather than a summed total', () => {
		const { logged } = setupPrinter();

		printScanSummary({ findings: [finding(), finding({ siteKey: 'size:two' })], reportPath: '.lightsout/scan.json' });

		// an advisory is guidance to judge, not work outstanding
		expect(cellsOf({ logged }).at(-1)).toStrictEqual(['total', '—', '2']);
	});

	test('says so plainly when there is nothing at all, instead of drawing an empty table', () => {
		const { logged } = setupPrinter();

		printScanSummary({ findings: [], reportPath: '.lightsout/scan.json' });

		expect(logged.some((line) => line.includes('clean — no findings, no advisories'))).toBe(true);
		expect(logged.some((line) => line.startsWith('┌'))).toBe(false);
	});

	test('always names the report file, so the full evidence is one command away', () => {
		const { logged } = setupPrinter();

		printScanSummary({ findings: [finding()], reportPath: '.lightsout/scan.json' });

		expect(logged).toContain('report: .lightsout/scan.json');
	});
});
