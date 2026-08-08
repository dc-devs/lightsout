import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { printStandardsSummary } from '@/cli/common/render/printStandardsSummary';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.SizeFunction,
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

describe('printStandardsSummary', () => {
	test('counts blocking and advisory entries in separate columns', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({
			findings: [
				finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Blocking }),
				finding(),
				finding({ siteKey: 'size:two' }),
			],
			reportPath: '.lightsout/standards-check.json',
		});

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'blocking', 'advisories'],
			['module-boundary', '1', '—'],
			['size-function', '—', '2'],
			['total', '1', '2'],
		]);
	});

	test('a repo carrying only advisories reports zero blocking rather than a summed total', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [finding(), finding({ siteKey: 'size:two' })], reportPath: '.lightsout/standards-check.json' });

		// an advisory is guidance to judge, not work outstanding
		expect(cellsOf({ logged }).at(-1)).toStrictEqual(['total', '—', '2']);
	});

	test('says so plainly when there is nothing at all, instead of drawing an empty table', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [], reportPath: '.lightsout/standards-check.json' });

		expect(logged.some((line) => line.includes('clean — nothing blocking, no advisories'))).toBe(true);
		expect(logged.some((line) => line.startsWith('┌'))).toBe(false);
	});

	test('always names the report file, so the full evidence is one command away', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [finding()], reportPath: '.lightsout/standards-check.json' });

		expect(logged).toContain('report: .lightsout/standards-check.json');
	});
});
