import { describe, expect, jest, test } from '@jest/globals';
import { printStandardsRuleList } from '#src/cli/common/render/printStandardsRuleList.ts';
import { StandardsSeverity } from '#src/contracts/index.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/index.ts';

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: 'multi-export',
	doc: 'lightsout-defaults: code/style-guide/structure/one-export-per-file',
	summary: 'more than one export in a file',
	checked: true,
	severity: StandardsSeverity.Blocking,
	fromConfig: false,
	settings: {},
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
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

describe('printStandardsRuleList', () => {
	test('each rule gets its state, its checker and the doc it enforces, with its summary beneath', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [listing()] });

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'state', 'checked by', 'standards doc'],
			['multi-export', 'blocking', 'code', 'lightsout-defaults: code/style-guide/structure/one-export-per-file'],
			['more than one export in a file', '', '', ''],
			['1 rule(s)', '1 blocking', '0 advisory, 0 off', '1 by code, 0 by judgment'],
		]);
	});

	test('a rule no check covers says so on its own row', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [listing({ rule: 'premature-abstraction', summary: 'abstracting before the third use', checked: false })] });

		// real policy nothing mechanical will ever catch — a ledger that hid it
		// would read as though every listed rule were enforced
		expect(cellsOf({ logged })[1]?.[2]).toBe('judgment');
	});

	test('a row the repo configured is marked, so policy reads apart from default', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [listing({ severity: StandardsSeverity.Off, fromConfig: true })] });

		// "this is our policy" and "this is the default" are different answers
		expect(cellsOf({ logged })[1]?.[1]).toBe('off (config)');
	});

	test("a rule's live numbers ride along with its summary", () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [listing({ rule: 'clone', summary: 'token-level copy-paste spans', settings: { minTokens: 90 } })] });

		// a retuned knob is visible without opening the config
		expect(cellsOf({ logged })[2]?.[0]).toBe('token-level copy-paste spans — minTokens 90');
	});

	test('the totals line counts each state and both kinds of rule, including the rules that run at none', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({
			rules: [
				listing(),
				listing({ rule: 'clone', severity: StandardsSeverity.Advisory }),
				listing({ rule: 'filename-mismatch', severity: StandardsSeverity.Advisory }),
				listing({ rule: 'folder-census', severity: StandardsSeverity.Off }),
				listing({ rule: 'premature-abstraction', severity: StandardsSeverity.Advisory, checked: false }),
			],
		});

		expect(cellsOf({ logged }).at(-1)).toStrictEqual(['5 rule(s)', '1 blocking', '3 advisory, 1 off', '4 by code, 1 by judgment']);
	});

	test('a ledger holding no rules at all still prints its headings and a totals row of zeroes', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [] });

		// a package that states no rules is an empty ledger, not a broken one
		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'state', 'checked by', 'standards doc'],
			['0 rule(s)', '0 blocking', '0 advisory, 0 off', '0 by code, 0 by judgment'],
		]);
	});
});
