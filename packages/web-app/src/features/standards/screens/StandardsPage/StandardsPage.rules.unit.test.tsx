import { describe, expect, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsPage } from '#src/features/standards/index.ts';
import { buildStandardsFinding } from '#tests/helpers/buildStandardsFinding.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

const setupRuleList = ({ overrides = {} }: { overrides?: Partial<StandardsView> } = {}) => {
	renderWithQueryClient({ ui: <StandardsPage />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });

	// Scoped to the rule list, because a finding card offers a control carrying
	// the same rule id — one filters, the other opens the prose.
	return { rules: () => within(screen.getByRole('list', { name: 'Rules' })) };
};

/** Two rules with findings under one of them, which is what every filtering question here needs. */
const twoRules = {
	rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 2 }), buildStandardsRuleView({ rule: 'duplicate-code-block', findingCount: 0 })],
	findings: [
		buildStandardsFinding({ rule: 'size-file', paths: ['packages/engine/src/plan/a.ts'] }),
		buildStandardsFinding({ rule: 'size-file', paths: ['packages/engine/src/plan/b.ts'] }),
	],
};

describe('StandardsPage rule list', () => {
	test('lists a rule with nothing wrong under it, because an unknown rule is an unfollowed rule', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		const rule = rules().getByRole('button', { name: /^duplicate-code-block/ });

		expect(rule).toBeInTheDocument();
	});

	test('shows a dash rather than a zero for a rule with no open findings', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		const rule = rules().getByRole('button', { name: /^duplicate-code-block/ });

		expect(rule.textContent).toContain('—');
	});

	test('says whether code or judgment enforces each rule', () => {
		const { rules } = setupRuleList({
			overrides: { rules: [buildStandardsRuleView({ rule: 'single-return', checked: false, severity: StandardsSeverity.Advisory })] },
		});

		const rule = rules().getByRole('button', { name: /^single-return/ });

		expect(rule.textContent).toContain('judgment');
		expect(rule.textContent).toContain('advisory');
	});

	test('marks a rule whose severity this repo set, so a reader can tell policy from default', () => {
		const { rules } = setupRuleList({ overrides: { rules: [buildStandardsRuleView({ rule: 'size-file', fromConfig: true })] } });

		const rule = rules().getByRole('button', { name: /^size-file/ });

		expect(rule.textContent).toContain('from config');
	});

	test('starts with every finding shown', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		const all = rules().getByRole('button', { name: /^All rules/ });

		expect(all).toHaveAttribute('aria-pressed', 'true');
	});

	test('counts every finding on the all-rules row', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		const all = rules().getByRole('button', { name: /^All rules/ });

		expect(all.textContent).toContain('2');
	});

	test('narrows the findings to the rule a reader picks', () => {
		const { rules } = setupRuleList({
			overrides: {
				...twoRules,
				findings: [...twoRules.findings, buildStandardsFinding({ rule: 'duplicate-code-block', paths: ['packages/web-app/src/routes/index.tsx'] })],
			},
		});

		fireEvent.click(rules().getByRole('button', { name: /^duplicate-code-block/ }));

		expect(screen.queryByText('packages/engine/src/plan/a.ts')).not.toBeInTheDocument();
		expect(screen.getByText('packages/web-app/src/routes/index.tsx')).toBeInTheDocument();
	});

	test('says so in words when the rule a reader picked has nothing open under it', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		fireEvent.click(rules().getByRole('button', { name: /^duplicate-code-block/ }));

		expect(screen.getByText('Nothing is open under duplicate-code-block.')).toBeInTheDocument();
	});

	test('gives every finding back when the all-rules row is picked again', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		fireEvent.click(rules().getByRole('button', { name: /^duplicate-code-block/ }));
		fireEvent.click(rules().getByRole('button', { name: /^All rules/ }));

		expect(screen.getByText('packages/engine/src/plan/a.ts')).toBeInTheDocument();
	});
});

describe('StandardsPage rule drawer', () => {
	test('shows nothing until a reader asks to read a rule', () => {
		setupRuleList({ overrides: twoRules });

		const drawer = screen.queryByRole('dialog');

		expect(drawer).not.toBeInTheDocument();
	});

	test("opens a rule's own prose from the list", () => {
		setupRuleList({ overrides: { rules: [buildStandardsRuleView({ rule: 'size-file', prose: 'Files stay under ~250 lines.' })] } });

		fireEvent.click(screen.getByRole('button', { name: 'rule text: size-file' }));
		const drawer = screen.getByRole('dialog', { name: 'size-file' });

		expect(drawer.textContent).toContain('Files stay under ~250 lines.');
	});

	test('says in one line what the rule is and which document tree hands it out', () => {
		setupRuleList({ overrides: { rules: [buildStandardsRuleView({ rule: 'size-file' })] } });

		fireEvent.click(screen.getByRole('button', { name: 'rule text: size-file' }));
		const drawer = screen.getByRole('dialog', { name: 'size-file' });

		expect(drawer.textContent).toContain('a file over the standards line cap');
		expect(within(drawer).getByText('set').nextElementSibling?.textContent).toBe('code');
	});

	test('says which document states the rule and how this repo runs it', () => {
		setupRuleList({ overrides: { rules: [buildStandardsRuleView({ rule: 'size-file', fromConfig: true, settings: { file: 250, tsxFile: 300 } })] } });

		fireEvent.click(screen.getByRole('button', { name: 'rule text: size-file' }));
		const drawer = screen.getByRole('dialog', { name: 'size-file' });

		expect(drawer.textContent).toContain('code/style-guide/patterns/functions');
		expect(drawer.textContent).toContain('set by this repo, not the package');
		expect(drawer.textContent).toContain('tsxFile');
	});

	test('says a judgment-only rule is read by an agent rather than run by code', () => {
		setupRuleList({ overrides: { rules: [buildStandardsRuleView({ rule: 'single-return', checked: false, severity: StandardsSeverity.Advisory })] } });

		fireEvent.click(screen.getByRole('button', { name: 'rule text: single-return' }));
		const drawer = screen.getByRole('dialog', { name: 'single-return' });

		expect(drawer.textContent).toContain('judgment');
	});

	test('opens the same drawer from a finding, since a reader arrives from either side', () => {
		setupRuleList({ overrides: twoRules });

		fireEvent.click(screen.getAllByRole('button', { name: 'size-file' })[0]);
		const drawer = screen.getByRole('dialog', { name: 'size-file' });

		expect(drawer).toBeInTheDocument();
	});

	test('leaves the findings filter alone when a rule is only read, not selected', () => {
		const { rules } = setupRuleList({ overrides: twoRules });

		fireEvent.click(rules().getByRole('button', { name: 'rule text: duplicate-code-block' }));
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(rules().getByRole('button', { name: /^All rules/ })).toHaveAttribute('aria-pressed', 'true');
	});

	test('closes when a reader is done with it', () => {
		setupRuleList({ overrides: twoRules });

		fireEvent.click(screen.getByRole('button', { name: 'rule text: duplicate-code-block' }));
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
