import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackRuleView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RuleDetail } from '#src/features/packs/index.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The trail above the page links back to the packs list and to the pack, and a
// link needs a live router to resolve a path. A plain anchor keeps the
// assertions about where the page points.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupRuleDetail = ({ rule = buildStandardsPackRuleView() }: { rule?: StandardsPackRuleView } = {}) => {
	const pack = buildStandardsPackView();

	renderWithQueryClient({
		ui: <RuleDetail packName={pack.name} ruleId={rule.id} />,
		seed: [
			{ queryKey: [QueryKey.PackRule, pack.name, rule.id], data: rule },
			{ queryKey: [QueryKey.Pack, pack.name], data: pack },
		],
	});

	return { pack, rule };
};

/** The override block the settings card offers, parsed, so the assertion pins the entries rather than the indentation. */
const readOverrideSnippet = (): unknown => JSON.parse(screen.getByText(/"settings"/).textContent ?? '');

describe('RuleDetail', () => {
	test('shows the whole address a reader walked to get here, one step at a time', () => {
		setupRuleDetail();

		const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });

		expect(trail.textContent).toBe('Standards packslightsout-defaultscode/style-guide/typescript/type-assertionstype-assertion');
	});

	test('links the pack step of that trail back to the pack page', () => {
		setupRuleDetail();

		const crumb = screen.getByRole('link', { name: 'lightsout-defaults' });

		expect(crumb).toHaveAttribute('href', '/standards/lightsout-defaults');
	});

	test('names the rule as the page, and says what it catches', () => {
		setupRuleDetail();

		expect(screen.getByRole('heading', { level: 1, name: 'type-assertion' })).toBeInTheDocument();
		expect(screen.getByText('an `as` cast where narrowing would do')).toBeInTheDocument();
	});

	test('says who enforces the rule, how loudly it ships, and where it applies', () => {
		setupRuleDetail();

		expect(screen.getByText('enforced by code')).toBeInTheDocument();
		expect(screen.getByText('blocking by default')).toBeInTheDocument();
		expect(screen.getByText('base')).toBeInTheDocument();
		expect(screen.getByText('code')).toBeInTheDocument();
	});

	test('calls a judgment rule a judgment rule, and says it ships advisory, since much of the pack is both', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ overrides: { checked: false, defaultSeverity: StandardsSeverity.Advisory } }) });

		expect(screen.getByText('judgment')).toBeInTheDocument();
		expect(screen.getByText('advisory by default')).toBeInTheDocument();
	});

	test("prints the rule's own argument, which is what a reader needs in order to disagree with it", () => {
		setupRuleDetail();

		const prose = screen.getByText(/Avoid `as` casts/);

		expect(prose).toBeInTheDocument();
	});

	test('says as much for a rule that argues only through its example, rather than leaving a blank panel', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ prose: '' }) });

		const line = screen.getByText('This rule states its summary and proves it with an example.');

		expect(line).toBeInTheDocument();
	});

	test('shows both sides of the proof', () => {
		setupRuleDetail();

		expect(screen.getByText('return (value as string).toUpperCase();')).toBeInTheDocument();
		expect(screen.getByText(/if \(typeof value === 'string'\)/)).toBeInTheDocument();
	});

	test('lists the numbers a rule ships with, and the block that replaces one', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ id: 'file-size', overrides: { defaultSettings: { maxLines: 250 } } }) });

		expect(screen.getByRole('heading', { name: 'Its numbers' })).toBeInTheDocument();
		expect(readOverrideSnippet()).toStrictEqual({ 'standards-checks': { 'file-size': { settings: { maxLines: 250 } } } });
	});

	test('leaves that card off the rules that ship no numbers, which is most of them', () => {
		setupRuleDetail();

		const card = screen.queryByRole('heading', { name: 'Its numbers' });

		expect(card).not.toBeInTheDocument();
	});

	test('says plainly how a repo turns the rule down, both ways', () => {
		setupRuleDetail();

		expect(screen.getByText('"standards-checks": { "type-assertion": "advisory" }')).toBeInTheDocument();
		expect(screen.getByText('"standards-checks": { "type-assertion": "off" }')).toBeInTheDocument();
	});

	test('offers each of those lines for copying, since they are meant to be pasted rather than retyped', () => {
		setupRuleDetail();

		expect(screen.getByRole('button', { name: /copy advisory/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /copy off/i })).toBeInTheDocument();
	});
});
