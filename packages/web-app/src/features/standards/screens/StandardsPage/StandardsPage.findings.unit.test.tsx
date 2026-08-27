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

// Mocked Imports
// -------------------------
// The rule filter lives in the URL, so what the page reads back and what it
// writes are exactly what this file supplies and records. Everything else about
// the router stays real.
const mockNavigate = jest.fn<(options: { search: Record<string, unknown>; replace: boolean }) => void>();
const mockUseSearch = jest.fn<() => { rule?: string }>();

jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return { ...actual, useSearch: () => mockUseSearch(), useNavigate: () => mockNavigate };
});
// -------------------------

const setupFindings = ({ overrides = {}, rule }: { overrides?: Partial<StandardsView>; rule?: string } = {}) => {
	const mockWriteText = jest.fn<(text: string) => Promise<void>>();

	mockWriteText.mockResolvedValue();
	mockNavigate.mockReset();
	mockUseSearch.mockReturnValue({ rule });
	// jsdom implements the DOM, not the platform around it: navigator has no
	// clipboard at all, so the property is defined rather than spied on.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
	renderWithQueryClient({ ui: <StandardsPage />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });

	return { mockWriteText };
};

/** Open the one finding row on screen, which is where the guidance and the site key live. */
const openTheRow = () => {
	fireEvent.click(screen.getByRole('button', { name: 'Expand phases' }));
};

describe('StandardsPage findings', () => {
	test('says what one finding measured at its site', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ detail: '268 lines, cap is 250' })] } });

		const detail = screen.getByText('268 lines, cap is 250');

		expect(detail).toBeInTheDocument();
	});

	test('names the site a finding sits at, with the span the rule measured', () => {
		setupFindings({
			overrides: { findings: [{ ...buildStandardsFinding(), files: [{ path: 'packages/engine/src/plan/a.ts', startLine: 10, endLine: 42 }] }] },
		});

		const site = screen.getByText('packages/engine/src/plan/a.ts:10-42');

		expect(site).toBeInTheDocument();
	});

	test('shows a single line where a rule reported a point rather than a span', () => {
		setupFindings({ overrides: { findings: [{ ...buildStandardsFinding(), files: [{ path: 'packages/engine/src/plan/a.ts', startLine: 10 }] }] } });

		const site = screen.getByText('packages/engine/src/plan/a.ts:10');

		expect(site).toBeInTheDocument();
	});

	test('shows a finding that names no file at all, which a repo-wide rule reports', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ paths: [], detail: 'no standards pack is configured' })] } });

		const detail = screen.getByText('no standards pack is configured');

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

		expect(screen.getByText('blocking')).toBeInTheDocument();
		expect(screen.getByText('advisory')).toBeInTheDocument();
	});

	test("keeps the rule's standing advice behind the row, which is written once for every site it found", () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ guidance: 'Split the file or graduate it to a folder.' })] } });
		openTheRow();

		const guidance = screen.getByText('Split the file or graduate it to a folder.');

		expect(guidance).toBeInTheDocument();
	});

	test('names every file a finding covers once the row is open', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ paths: ['packages/engine/src/plan/a.ts'] })] } });
		openTheRow();

		const files = screen.getAllByText('packages/engine/src/plan/a.ts');

		expect(files.length).toBeGreaterThan(0);
	});

	test('hands the clipboard the site key exactly as the ledger records it', async () => {
		const { mockWriteText } = setupFindings({ overrides: { findings: [buildStandardsFinding({ siteKey: 'size-file:packages/engine/src/plan/a.ts' })] } });
		openTheRow();

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Copy site key' }));
		});

		expect(mockWriteText).toHaveBeenCalledWith('size-file:packages/engine/src/plan/a.ts');
	});

	test('closes a row a reader opened again, so the advice does not stay under every row they touched', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ guidance: 'Split the file or graduate it to a folder.' })] } });
		openTheRow();

		fireEvent.click(screen.getByRole('button', { name: 'Collapse phases' }));

		expect(screen.queryByText('Split the file or graduate it to a folder.')).not.toBeInTheDocument();
	});

	test('still hands over the site key of a finding that names no file, since that key is what the refactor pipeline works in', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ paths: [], siteKey: 'no-standards-pack:.' })] } });
		openTheRow();

		const siteKey = screen.getByText('no-standards-pack:.');

		expect(siteKey).toBeInTheDocument();
		expect(within(screen.getByRole('table')).queryAllByRole('listitem')).toHaveLength(0);
	});

	test('shows a finding whose rule no pack loads any more, rather than hiding it', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'retired-rule', detail: 'a rule that has since gone' })] } });

		const detail = screen.getByText('a rule that has since gone');

		expect(detail).toBeInTheDocument();
	});

	test('marks such a finding as having no prose left behind it, while it still filters like any other', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'retired-rule' })] } });

		expect(screen.getByRole('button', { name: 'retired-rule' })).toBeInTheDocument();
		expect(screen.getByText('not loaded')).toBeInTheDocument();
	});

	test('says nothing is open rather than leaving the region blank', () => {
		setupFindings();

		const notice = screen.getByText('Nothing is open in the latest snapshot.');

		expect(notice).toBeInTheDocument();
	});

	test('says which rule it answered when a narrowed table comes back empty', () => {
		setupFindings({ rule: 'size-file' });

		const notice = screen.getByText('Nothing is open under size-file.');

		expect(notice).toBeInTheDocument();
	});

	test('writes the rule a reader pressed into the URL, so a narrowed page is a link somebody can send', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'size-file' })] } });

		fireEvent.click(screen.getByRole('button', { name: 'size-file' }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { rule: 'size-file' }, replace: true });
	});

	test('clears the filter when the rule already in charge is pressed again', () => {
		setupFindings({ overrides: { findings: [buildStandardsFinding({ rule: 'size-file' })] }, rule: 'size-file' });

		fireEvent.click(screen.getByRole('button', { name: 'size-file' }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { rule: undefined }, replace: true });
	});

	test('narrows the table to the rule the URL named', () => {
		setupFindings({
			overrides: {
				rules: [buildStandardsRuleView({ rule: 'size-file' }), buildStandardsRuleView({ rule: 'duplicate-code-block' })],
				findings: [
					buildStandardsFinding({ rule: 'size-file', detail: 'the long file' }),
					buildStandardsFinding({ rule: 'duplicate-code-block', paths: ['b/two.ts'], detail: 'the copied block' }),
				],
			},
			rule: 'size-file',
		});

		expect(screen.getByText('the long file')).toBeInTheDocument();
		expect(screen.queryByText('the copied block')).not.toBeInTheDocument();
	});
});

describe('StandardsPage folder facet', () => {
	const spread = {
		rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 3 })],
		findings: [
			buildStandardsFinding({ paths: ['packages/engine/src/plan/a.ts'], detail: 'engine one' }),
			buildStandardsFinding({ paths: ['packages/engine/src/plan/b.ts'], detail: 'engine two' }),
			buildStandardsFinding({ paths: ['packages/web-app/src/routes/index.tsx'], detail: 'web one' }),
		],
	};

	test('gathers the findings under the folder they sit in, largest first', () => {
		setupFindings({ overrides: spread });

		const folders = within(screen.getByRole('list', { name: 'Folders' })).getAllByRole('button');

		expect(folders[0].textContent).toContain('packages/engine/src/plan');
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

	test('draws each bar as a share of the largest bucket, which is how one folder holding the debt shows at a glance', () => {
		setupFindings({ overrides: spread });

		const [biggest, smaller] = within(screen.getByRole('list', { name: 'Folders' }))
			.getAllByRole('button')
			.map((folder) => folder.querySelector('span[aria-hidden="true"] > span'));

		expect(biggest).toHaveStyle({ width: '100%' });
		expect(smaller).toHaveStyle({ width: '50%' });
	});

	test('narrows the table to a folder a reader pressed', () => {
		setupFindings({ overrides: spread });

		fireEvent.click(screen.getByRole('button', { name: /packages\/web-app\/src\/routes/ }));

		expect(screen.getByText('web one')).toBeInTheDocument();
		expect(screen.queryByText('engine one')).not.toBeInTheDocument();
	});

	test('clears that narrowing when the folder already in charge is pressed again', () => {
		setupFindings({ overrides: spread });

		fireEvent.click(screen.getByRole('button', { name: /packages\/web-app\/src\/routes/ }));
		fireEvent.click(screen.getByRole('button', { name: /packages\/web-app\/src\/routes/ }));

		expect(screen.getByText('engine one')).toBeInTheDocument();
	});

	test('places a finding that names no file under the root, and narrows the table there like any other folder', () => {
		setupFindings({
			overrides: {
				findings: [
					buildStandardsFinding({ paths: [], detail: 'no standards pack is configured' }),
					buildStandardsFinding({ paths: ['a/one.ts'], detail: 'the long file' }),
				],
			},
		});

		fireEvent.click(within(screen.getByRole('list', { name: 'Folders' })).getByRole('button', { name: /^\./ }));

		expect(screen.getByText('no standards pack is configured')).toBeInTheDocument();
		expect(screen.queryByText('the long file')).not.toBeInTheDocument();
	});

	test('says which folder it answered when the depth dial moves the labels out from under the filter', () => {
		setupFindings({ overrides: spread });

		fireEvent.click(screen.getByRole('button', { name: /packages\/web-app\/src\/routes/ }));
		fireEvent.click(screen.getByRole('button', { name: '3' }));

		expect(screen.getByText('Narrowed to packages/web-app/src/routes.')).toBeInTheDocument();
	});

	test('has nothing to place when nothing is open', () => {
		setupFindings();

		const notice = screen.getByText('No findings to place.');

		expect(notice).toBeInTheDocument();
	});
});
