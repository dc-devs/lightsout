import { describe, expect, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { fireEvent, screen, within } from '@testing-library/react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsPage } from '#src/features/standards/index.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

const setupHistory = ({ overrides = {} }: { overrides?: Partial<StandardsView> } = {}) => {
	renderWithQueryClient({ ui: <StandardsPage />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });

	// Scoped to the group each count belongs to, because the whole point of the
	// panel is that a site count and an advice count are never one number.
	return {
		group: ({ name }: { name: string }) => {
			const heading = screen.getByText(name);
			const group = heading.parentElement;

			if (group === null) {
				throw new Error(`the ${name} group rendered without a container`);
			}

			return within(group);
		},
		rules: () => within(screen.getByRole('list', { name: 'Rules' })),
	};
};

const worked = {
	rules: [
		buildStandardsRuleView({
			rule: 'size-file',
			history: {
				attempted: 9,
				resolved: 6,
				declined: 2,
				untracked: 1,
				adviceApplied: 4,
				adviceDeclined: 3,
				adviceAlreadyMet: 0,
				reasons: ['the split would spread one flow over four files'],
			},
		}),
		buildStandardsRuleView({ rule: 'clone', history: { attempted: 5, resolved: 5, adviceApplied: 1 } }),
	],
};

describe('StandardsPage refactor history', () => {
	test('adds every loaded rule together when no rule is picked, so the panel is never blank', () => {
		const { group } = setupHistory({ overrides: worked });

		const sites = group({ name: 'Sites' });

		expect(sites.getByText('attempted').nextElementSibling?.textContent).toBe('14');
	});

	test('says the numbers are a sum rather than one rule', () => {
		const { group } = setupHistory({ overrides: worked });

		const note = screen.getByText('Every loaded rule, added together.');

		expect(note).toBeInTheDocument();
		expect(group({ name: 'Sites' }).getByText('resolved').nextElementSibling?.textContent).toBe('11');
	});

	test('narrows to one rule when a reader picks it', () => {
		const { group, rules } = setupHistory({ overrides: worked });

		fireEvent.click(rules().getByRole('button', { name: /^size-file/ }));

		expect(screen.getByText('Recorded against size-file.')).toBeInTheDocument();
		expect(group({ name: 'Sites' }).getByText('untracked').nextElementSibling?.textContent).toBe('1');
	});

	test('keeps the site counts and the advice counts as two separate groups', () => {
		const { group } = setupHistory({ overrides: worked });

		expect(group({ name: 'Sites' }).queryByText('applied')).not.toBeInTheDocument();
		expect(group({ name: 'Advice' }).getByText('applied').nextElementSibling?.textContent).toBe('5');
	});

	test('says what recorded each group, since one is re-checked on disk and the other is not', () => {
		setupHistory({ overrides: worked });

		expect(screen.getByText(/re-checked on disk afterwards/)).toBeInTheDocument();
		expect(screen.getByText(/as the agent reported answering them/)).toBeInTheDocument();
	});

	test('quotes the reasons a rule was left standing, because a decline rate alone says which rule to distrust and never why', () => {
		const { rules } = setupHistory({ overrides: worked });

		fireEvent.click(rules().getByRole('button', { name: /^size-file/ }));

		expect(screen.getByText('the split would spread one flow over four files')).toBeInTheDocument();
	});

	test('states a repeated reason once however the agent spaced it, and drops one that says nothing', () => {
		const { group, rules } = setupHistory({
			overrides: {
				rules: [
					buildStandardsRuleView({
						rule: 'size-file',
						history: { reasons: ['the split would spread one flow over four files', 'the  split would spread one flow\nover four files', '   '] },
					}),
				],
			},
		});

		fireEvent.click(rules().getByRole('button', { name: /^size-file/ }));

		expect(
			group({ name: 'Reasons recorded' })
				.getAllByRole('listitem')
				.map((item) => item.textContent),
		).toStrictEqual(['the split would spread one flow over four files']);
	});

	test('shows no reasons block for a rule nothing was recorded against', () => {
		const { rules } = setupHistory({ overrides: worked });

		fireEvent.click(rules().getByRole('button', { name: /^clone/ }));

		expect(screen.queryByText('Reasons recorded')).not.toBeInTheDocument();
	});
});
