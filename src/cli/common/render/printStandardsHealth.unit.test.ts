import { expect, describe, test, jest } from '@jest/globals';
import type { StandardsHealth, StandardsHealthRule } from '@/standardsCheck';
import { printStandardsHealth } from '@/cli/common/render/printStandardsHealth';

const healthRule = (overrides: Partial<StandardsHealthRule> & { id: string }): StandardsHealthRule => ({
	set: 'code',
	documentPath: 'code/architecture/folder-structure',
	checked: true,
	attempted: 0,
	resolved: 0,
	declined: 0,
	untracked: 0,
	adviceApplied: 0,
	adviceDeclined: 0,
	reasons: [],
	...overrides,
});

const healthOf = ({ rules }: { rules: StandardsHealthRule[] }): StandardsHealth => ({
	rules,
	totals: { rules: rules.length, checked: rules.filter((rule) => rule.checked).length, judgment: rules.filter((rule) => !rule.checked).length },
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

describe('printStandardsHealth', () => {
	test('a rule nobody has ever put to the test reads as dashes, never as zeroes', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({ health: healthOf({ rules: [healthRule({ id: 'path-aliases', checked: false })] }) });

		// 0% would answer a question nobody asked
		expect(cellsOf({ logged })[1]).toStrictEqual(['path-aliases', 'judgment', '—', '—', '—', '—', '—', '—', '—']);
	});

	test('the two accounts sit in their own columns, each with its own rate', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({
			health: healthOf({
				rules: [healthRule({ id: 'multi-export', attempted: 4, resolved: 2, declined: 1, untracked: 1, adviceApplied: 3, adviceDeclined: 1 })],
			}),
		});

		expect(cellsOf({ logged })[1]).toStrictEqual(['multi-export', 'code', '4', '2', '1', '1', '25%', '4', '25%']);
	});

	test('each recorded reason prints once beneath its rule', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({
			health: healthOf({
				rules: [healthRule({ id: 'multi-export', attempted: 1, declined: 1, reasons: ['[plan] the barrel would break', '[plan] the barrel would break', '[other] deliberate'] })],
			}),
		});

		const rows = cellsOf({ logged });

		// the same rationale repeats across a rule's batches; a reader needs it once
		expect(rows[2]?.[0]).toBe('· [plan] the barrel would break');
		expect(rows[3]?.[0]).toBe('· [other] deliberate');
	});

	test('a reason wrapped over several lines prints as one, and a blank one prints not at all', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({
			health: healthOf({
				rules: [healthRule({ id: 'multi-export', attempted: 2, declined: 2, reasons: ['  ', '[plan]\n\tthe barrel   would break'] })],
			}),
		});

		const rows = cellsOf({ logged });

		// a rationale recorded across lines is still one argument, and an empty
		// string is no argument at all
		expect(rows[2]?.[0]).toBe('· [plan] the barrel would break');
		// nothing follows it but the totals row — the blank reason took no line
		expect(rows[3]?.[0]).toBe('1 rule(s)');
	});

	test('a long reason is cut rather than stretching the whole table', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({
			health: healthOf({ rules: [healthRule({ id: 'multi-export', attempted: 1, declined: 1, reasons: ['x'.repeat(200)] })] }),
		});

		const reason = cellsOf({ logged })[2]?.[0] ?? '';

		expect(reason.length).toBeLessThan(100);
		expect(reason.endsWith('…')).toBe(true);
	});

	test('the totals row states the coverage claim and sums both accounts', () => {
		const { logged } = setupPrinter();

		printStandardsHealth({
			health: healthOf({
				rules: [
					healthRule({ id: 'multi-export', attempted: 2, resolved: 1, declined: 1 }),
					healthRule({ id: 'path-aliases', checked: false, adviceApplied: 1, adviceDeclined: 1 }),
				],
			}),
		});

		const rows = cellsOf({ logged });

		expect(rows[rows.length - 1]).toStrictEqual(['2 rule(s)', '1 by code, 1 by judgment', '2', '1', '1', '—', '50%', '2', '50%']);
	});
});
