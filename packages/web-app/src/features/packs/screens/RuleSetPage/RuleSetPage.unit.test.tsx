import { describe, expect, jest, test } from '@jest/globals';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import type { PackRuleFilters } from '#src/features/packs/internal/common/types/PackRuleFilters.ts';
import { RuleSetPage } from '#src/features/packs/screens/RuleSetPage/RuleSetPage.tsx';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Every rule is a link, and a link needs a live router to resolve a path. A
// plain anchor keeps the assertions about where a row points.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/** The default pack as the page reads it: two TypeScript documents, one React one. */
const defaultPack = buildStandardsPackView({
	rules: [
		buildStandardsPackRuleListing({ id: 'folder-size', documentPath: 'code/architecture/folder-structure', summary: 'a folder holding too many things' }),
		buildStandardsPackRuleListing({
			id: 'casing',
			documentPath: 'code/style-guide/conventions/casing',
			summary: 'a name spelled in the wrong case',
			checked: false,
			defaultSeverity: StandardsSeverity.Advisory,
		}),
		buildStandardsPackRuleListing({
			id: 'test-shared-let',
			set: StandardsSet.Tests,
			documentPath: 'tests/unit-testing',
			summary: 'a let shared between tests',
		}),
		buildStandardsPackRuleListing({ id: 'component-file-structure', documentPath: 'code/architecture/react', channel: 'react', checked: false }),
	],
	documents: [
		{
			set: StandardsSet.Code,
			path: 'code/architecture/folder-structure',
			channel: 'base',
			intro: '# Folder Structure\n\nWhere things live.',
			ruleIds: ['folder-size'],
		},
		{ set: StandardsSet.Code, path: 'code/style-guide/conventions/casing', channel: 'base', intro: '# Casing', ruleIds: ['casing'] },
		{ set: StandardsSet.Tests, path: 'tests/unit-testing', channel: 'base', intro: '# Unit Testing', ruleIds: ['test-shared-let'] },
		{ set: StandardsSet.Code, path: 'code/architecture/react', channel: 'react', intro: '# React Architecture', ruleIds: ['component-file-structure'] },
	],
});

const setupRuleSetPage = ({ ruleSet = 'typescript', filters = {} }: { ruleSet?: string; filters?: PackRuleFilters } = {}) => {
	const onFiltersChange = jest.fn<(filters: PackRuleFilters) => void>();

	renderWithQueryClient({
		ui: <RuleSetPage ruleSet={ruleSet} filters={filters} onFiltersChange={onFiltersChange} />,
		seed: [{ queryKey: [QueryKey.DefaultPack], data: defaultPack }],
	});

	return { onFiltersChange };
};

/** The rule list's group headings, in page order, without their counts. */
const readGroupTitles = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.firstChild?.textContent);

describe('RuleSetPage', () => {
	test('names the set by the name a reader knows it by', () => {
		setupRuleSetPage();

		expect(screen.getByRole('heading', { level: 1, name: 'TypeScript' })).toBeInTheDocument();
	});

	test('counts the whole set, and how many are deterministic checks and how many agent checks', () => {
		setupRuleSetPage();

		const figures = screen.getAllByRole('term').map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);

		expect(figures).toStrictEqual(['Rules: 3', 'Deterministic checks: 2', 'Agent checks: 1']);
	});

	test('groups the set’s rules under the document that states each, in the pack’s own order', () => {
		setupRuleSetPage();

		expect(readGroupTitles()).toStrictEqual(['Folder Structure', 'Casing', 'Unit Testing']);
	});

	test('lists every document beside the rules, under its area, as a way to jump to it', () => {
		setupRuleSetPage();

		const nav = screen.getByRole('navigation', { name: 'Rule groups' });

		expect([within(nav).getByText('Architecture'), within(nav).getByText('Style guide'), within(nav).getByText('Unit testing')]).toHaveLength(3);
	});

	test('opens a rule at its address in the set', () => {
		setupRuleSetPage();

		expect(screen.getByRole('link', { name: /^folder-size/ })).toHaveAttribute('href', '/standards-packs/typescript/folder-size');
	});

	test('says each rule’s kind of check, and whether it blocks a run or only advises', () => {
		setupRuleSetPage();

		const row = screen.getByRole('link', { name: /^casing/ });

		expect([within(row).getByText('Agent'), within(row).getByText('Advises')]).toHaveLength(2);
	});

	test('narrows the list to what the reader searched for, but keeps the whole set’s counts', () => {
		setupRuleSetPage({ filters: { text: 'folder' } });

		expect({ groups: readGroupTitles(), rules: screen.getAllByRole('term')[0]?.nextElementSibling?.textContent }).toStrictEqual({
			groups: ['Folder Structure'],
			rules: '3',
		});
	});

	test('hands a typed search back to the route, dropping it once the box is cleared', () => {
		const { onFiltersChange } = setupRuleSetPage({ filters: { text: 'f' } });

		fireEvent.change(screen.getByRole('searchbox', { name: 'Search rules' }), { target: { value: '' } });

		expect(onFiltersChange).toHaveBeenCalledWith({ text: undefined });
	});

	test('says plainly when nothing matches, rather than showing an empty page', () => {
		setupRuleSetPage({ filters: { text: 'nothing like this' } });

		expect(screen.getByText('No rule matches that.')).toBeInTheDocument();
	});

	test('says a framework’s rules are added to the TypeScript ones, and links there', () => {
		setupRuleSetPage({ ruleSet: 'react' });

		expect(screen.getByRole('link', { name: 'TypeScript rules' })).toHaveAttribute('href', '/standards-packs/typescript');
	});
});
