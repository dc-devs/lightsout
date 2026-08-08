import { expect, describe, test, jest } from '@jest/globals';
import { StandardsSeverity } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck';
import { printStandardsRuleList } from '@/cli/common/render/printStandardsRuleList';

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: 'multi-export',
	doc: 'standards/code/style-guide/structure/one-export-per-file.md',
	summary: 'more than one export in a file',
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
	logged.filter((line) => line.startsWith('│')).map((line) => line.split('│').slice(1, -1).map((cell) => cell.trim()));

describe('printStandardsRuleList', () => {
	test('each rule gets its state and the doc it enforces, with its summary beneath', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({ rules: [listing()] });

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'state', 'standards doc'],
			['multi-export', 'blocking', 'standards/code/style-guide/structure/one-export-per-file.md'],
			['more than one export in a file', '', ''],
			['1 rule(s)', '1 blocking', '0 advisory, 0 off'],
		]);
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

	test('the totals line counts each state, including the rules that run at none', () => {
		const { logged } = setupPrinter();

		printStandardsRuleList({
			rules: [
				listing(),
				listing({ rule: 'clone', severity: StandardsSeverity.Advisory }),
				listing({ rule: 'filename-mismatch', severity: StandardsSeverity.Advisory }),
				listing({ rule: 'folder-census', severity: StandardsSeverity.Off }),
			],
		});

		expect(cellsOf({ logged }).at(-1)).toStrictEqual(['4 rule(s)', '1 blocking', '2 advisory, 1 off']);
	});
});
