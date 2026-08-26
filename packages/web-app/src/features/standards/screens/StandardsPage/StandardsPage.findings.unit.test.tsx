import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsPage } from '#src/features/standards/index.ts';
import { buildStandardsFinding } from '#tests/helpers/buildStandardsFinding.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

const setupFindings = ({ overrides = {} }: { overrides?: Partial<StandardsView> } = {}) => {
	const mockWriteText = jest.fn<(text: string) => Promise<void>>();

	mockWriteText.mockResolvedValue();
	// jsdom implements the DOM, not the platform around it: navigator has no
	// clipboard at all, so the property is defined rather than spied on.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
	renderWithQueryClient({ ui: <StandardsPage />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });

	return { mockWriteText };
};

describe('StandardsPage findings', () => {
	test('says what one finding measured at its site', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ detail: '268 lines, cap is 250' })] } });

		const detail = screen.getByText('268 lines, cap is 250');

		expect(detail).toBeInTheDocument();
	});

	test("shows the rule's standing advice, which is written once for every site it found", () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ guidance: 'Split the file or graduate it to a folder.' })] } });

		const guidance = screen.getByText('Split the file or graduate it to a folder.');

		expect(guidance).toBeInTheDocument();
	});

	test('names every file a finding covers, with the span when the rule reported one', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ paths: ['packages/engine/src/plan/a.ts'] })] } });

		const file = screen.getByText('packages/engine/src/plan/a.ts');

		expect(file).toBeInTheDocument();
	});

	test('carries the span a rule measured, since a 268-line file is not wrong at line one', () => {
		setupFindings({
			overrides: { findings: [{ ...buildStandardsFinding(), files: [{ path: 'packages/engine/src/plan/a.ts', startLine: 10, endLine: 42 }] }] },
		});

		const file = screen.getByText('packages/engine/src/plan/a.ts:10-42');

		expect(file).toBeInTheDocument();
	});

	test('shows a single line where a rule reported a point rather than a span', () => {
		setupFindings({ overrides: { findings: [{ ...buildStandardsFinding(), files: [{ path: 'packages/engine/src/plan/a.ts', startLine: 10 }] }] } });

		const file = screen.getByText('packages/engine/src/plan/a.ts:10');

		expect(file).toBeInTheDocument();
	});

	test('shows a finding that names no file at all, which a repo-wide rule reports', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ paths: [], detail: 'no standards package is configured' })] } });

		const detail = screen.getByText('no standards package is configured');

		expect(detail).toBeInTheDocument();
	});

	test('marks a blocking finding apart from an advisory one', () => {
		setupFindings({
			overrides: {
				findings: [
					buildStandardsFinding({ rule: 'size-file', paths: ['a/one.ts'] }),
					buildStandardsFinding({ rule: 'single-return', severity: StandardsSeverity.Advisory, paths: ['a/two.ts'] }),
				],
			},
		});

		const [first, second] = screen.getAllByRole('article');

		expect(within(first).getByText('blocking')).toBeInTheDocument();
		expect(within(second).getByText('advisory')).toBeInTheDocument();
	});

	test('hands the clipboard the site key exactly as the ledger records it', async () => {
		const { mockWriteText } = setupFindings({ overrides: { findings: [buildStandardsFinding({ siteKey: 'size-file:packages/engine/src/plan/a.ts' })] } });

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Copy site key' }));
		});

		expect(mockWriteText).toHaveBeenCalledWith('size-file:packages/engine/src/plan/a.ts');
	});

	test('shows a finding whose rule no package loads any more, rather than hiding it', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'retired-rule', detail: 'a rule that has since gone' })] } });

		const detail = screen.getByText('a rule that has since gone');

		expect(detail).toBeInTheDocument();
	});

	test('offers no prose for such a finding, and says why instead', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'retired-rule' })] } });

		expect(screen.queryByRole('button', { name: 'retired-rule' })).not.toBeInTheDocument();
		expect(screen.getByText('not loaded')).toBeInTheDocument();
	});

	test('says nothing is open rather than leaving the region blank', () => {
		setupFindings();

		const notice = screen.getByText('Nothing is open in the latest snapshot.');

		expect(notice).toBeInTheDocument();
	});
});

describe('StandardsPage folder breakdown', () => {
	const spread = {
		rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 3 })],
		findings: [
			buildStandardsFinding({ paths: ['packages/engine/src/plan/a.ts'] }),
			buildStandardsFinding({ paths: ['packages/engine/src/plan/b.ts'] }),
			buildStandardsFinding({ paths: ['packages/web-app/src/routes/index.tsx'] }),
		],
	};

	test('gathers the findings under the folder they sit in, largest first', () => {
		setupFindings({ overrides: spread });

		const folders = screen.getAllByRole('group');

		expect(within(folders[0]).getByText('packages/engine/src/plan')).toBeInTheDocument();
	});

	test('regroups at a shallower depth when a reader turns the dial', () => {
		setupFindings({ overrides: spread });

		fireEvent.click(screen.getByRole('button', { name: '3' }));

		expect(screen.getByText('packages/engine/src')).toBeInTheDocument();
	});

	test('marks which depth is showing, so the dial reads as a choice already made', () => {
		setupFindings({ overrides: spread });

		expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
	});

	test('names the rules behind a folder when it is opened', () => {
		setupFindings({ overrides: spread });

		const folder = screen.getAllByRole('group')[0];

		expect(within(folder).getByText('2 findings')).toBeInTheDocument();
	});

	test('draws each bar as a share of the largest bucket, which is how one folder holding the debt shows at a glance', () => {
		setupFindings({ overrides: spread });

		const [biggest, smaller] = screen.getAllByRole('group').map((folder) => folder.querySelector('span[aria-hidden="true"] > span'));

		expect(biggest).toHaveStyle({ width: '100%' });
		expect(smaller).toHaveStyle({ width: '50%' });
	});

	test('honours the rule filter, so picking a rule answers where it is', () => {
		setupFindings({
			overrides: {
				rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 2 }), buildStandardsRuleView({ rule: 'duplicate-code-block', findingCount: 1 })],
				findings: [
					buildStandardsFinding({ rule: 'size-file', paths: ['packages/engine/src/plan/a.ts'] }),
					buildStandardsFinding({ rule: 'duplicate-code-block', paths: ['packages/web-app/src/routes/index.tsx'] }),
				],
			},
		});

		fireEvent.click(within(screen.getByRole('list', { name: 'Rules' })).getByRole('button', { name: /^duplicate-code-block/ }));

		expect(screen.queryByText('packages/engine/src/plan')).not.toBeInTheDocument();
		expect(screen.getByText('packages/web-app/src/routes')).toBeInTheDocument();
	});

	test('has nothing to place when nothing is open', () => {
		setupFindings();

		const notice = screen.getByText('No findings to place.');

		expect(notice).toBeInTheDocument();
	});
});
