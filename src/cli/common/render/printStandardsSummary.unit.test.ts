import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck';
import { printStandardsSummary } from '@/cli/common/render/printStandardsSummary';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.SizeFunction,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: StandardsRule.SizeFunction,
	doc: 'standards/code/style-guide/structure/function-size.md',
	summary: 'a function longer than the size cap',
	severity: StandardsSeverity.Advisory,
	fromConfig: false,
	settings: {},
	...overrides,
});

const rules: StandardsRuleListing[] = [
	listing(),
	listing({ rule: StandardsRule.ModuleBoundary, summary: 'a file deep-imported across a module boundary', severity: StandardsSeverity.Blocking }),
];

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
			rules,
			reportPath: '.lightsout/standards-check.json',
		});

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'blocking', 'advisories'],
			['module-boundary', '1', '—'],
			['a file deep-imported across a module boundary', '', ''],
			['size-function', '—', '2'],
			['a function longer than the size cap', '', ''],
			['total', '1', '2'],
		]);
	});

	test('a repo carrying only advisories reports zero blocking rather than a summed total', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [finding(), finding({ siteKey: 'size:two' })], rules, reportPath: '.lightsout/standards-check.json' });

		// an advisory is guidance to judge, not work outstanding
		expect(cellsOf({ logged }).at(-1)).toStrictEqual(['total', '—', '2']);
	});

	test('says so plainly when there is nothing at all, instead of drawing an empty table', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [], rules, reportPath: '.lightsout/standards-check.json' });

		expect(logged.some((line) => line.includes('clean — nothing blocking, no advisories'))).toBe(true);
		expect(logged.some((line) => line.startsWith('┌'))).toBe(false);
	});

	test('always names the report file, so the full evidence is one command away', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({ findings: [finding()], rules, reportPath: '.lightsout/standards-check.json' });

		expect(logged).toContain('report: .lightsout/standards-check.json');
	});

	test('carries each reported rule summary beneath its own row, because a rule id says nothing on its own', () => {
		const { logged } = setupPrinter();

		printStandardsSummary({
			findings: [finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Blocking }), finding()],
			rules,
			reportPath: '.lightsout/standards-check.json',
		});

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'blocking', 'advisories'],
			['module-boundary', '1', '—'],
			['a file deep-imported across a module boundary', '', ''],
			['size-function', '—', '1'],
			['a function longer than the size cap', '', ''],
			['total', '1', '1'],
		]);
	});

	test('a rule the listing never names still reports its counts, with an empty summary line', () => {
		const { logged } = setupPrinter();

		// a rule id can outlive the listing it was resolved from — the tally is the
		// answer the reader asked for, and losing it to a missing summary would be
		// the wrong trade
		printStandardsSummary({ findings: [finding({ rule: StandardsRule.Clone })], rules, reportPath: '.lightsout/standards-check.json' });

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'blocking', 'advisories'],
			['clone', '—', '1'],
			['', '', ''],
			['total', '—', '1'],
		]);
	});
});
