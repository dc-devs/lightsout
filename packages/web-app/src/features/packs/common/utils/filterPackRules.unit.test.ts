import { describe, expect, test } from '@jest/globals';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';
import { filterPackRules } from '#src/features/packs/common/utils/filterPackRules.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';

const rules = [
	buildStandardsPackRuleListing({ id: 'type-assertion', set: StandardsSet.Code, channel: 'base', checked: true, defaultSeverity: StandardsSeverity.Blocking }),
	buildStandardsPackRuleListing({
		id: 'test-shared-let',
		set: StandardsSet.Tests,
		channel: 'base',
		checked: true,
		defaultSeverity: StandardsSeverity.Advisory,
		summary: 'a let shared between tests',
	}),
	buildStandardsPackRuleListing({
		id: 'component-file-structure',
		set: StandardsSet.Code,
		channel: 'react',
		checked: false,
		defaultSeverity: StandardsSeverity.Advisory,
		summary: 'a component folder that bundles nothing',
	}),
];

const setupFilterPackRules = ({ filters = {} }: { filters?: PackRuleFilters } = {}) => ({ ids: filterPackRules({ rules, filters }).map((rule) => rule.id) });

describe('filterPackRules', () => {
	test('narrows nothing when nothing was asked for, so an untouched page shows the whole pack', () => {
		const { ids } = setupFilterPackRules();

		expect(ids).toStrictEqual(['type-assertion', 'test-shared-let', 'component-file-structure']);
	});

	test('keeps only the rules of the set asked for', () => {
		const { ids } = setupFilterPackRules({ filters: { set: StandardsSet.Tests } });

		expect(ids).toStrictEqual(['test-shared-let']);
	});

	test('keeps only the rules of the channel asked for, so a React repo can see what applies to it', () => {
		const { ids } = setupFilterPackRules({ filters: { channel: 'react' } });

		expect(ids).toStrictEqual(['component-file-structure']);
	});

	test('keeps only what code enforces when the reader asked for that half', () => {
		const { ids } = setupFilterPackRules({ filters: { checked: true } });

		expect(ids).toStrictEqual(['type-assertion', 'test-shared-let']);
	});

	test('keeps only what judgment decides when the reader asked for the other half', () => {
		const { ids } = setupFilterPackRules({ filters: { checked: false } });

		expect(ids).toStrictEqual(['component-file-structure']);
	});

	test('keeps only the rules that ship at the severity asked for', () => {
		const { ids } = setupFilterPackRules({ filters: { severity: StandardsSeverity.Blocking } });

		expect(ids).toStrictEqual(['type-assertion']);
	});

	test('matches free text against a rule id, wherever in the id it falls', () => {
		const { ids } = setupFilterPackRules({ filters: { text: 'assert' } });

		expect(ids).toStrictEqual(['type-assertion']);
	});

	test("matches free text against the rule's summary too, since a reader searches for the problem rather than the name", () => {
		const { ids } = setupFilterPackRules({ filters: { text: 'bundles nothing' } });

		expect(ids).toStrictEqual(['component-file-structure']);
	});

	test('ignores the case of what was typed, because nobody types a rule id in the case it is stored in', () => {
		const { ids } = setupFilterPackRules({ filters: { text: 'TYPE-Assertion' } });

		expect(ids).toStrictEqual(['type-assertion']);
	});

	test('treats a box holding only spaces as an empty box rather than as text nothing matches', () => {
		const { ids } = setupFilterPackRules({ filters: { text: '   ' } });

		expect(ids).toStrictEqual(['type-assertion', 'test-shared-let', 'component-file-structure']);
	});

	test('applies every filter at once, so two narrowings are an intersection rather than a union', () => {
		const { ids } = setupFilterPackRules({ filters: { set: StandardsSet.Code, checked: false } });

		expect(ids).toStrictEqual(['component-file-structure']);
	});

	test('answers with nothing when the filters agree on no rule, which is what the page renders its empty state from', () => {
		const { ids } = setupFilterPackRules({ filters: { set: StandardsSet.Tests, channel: 'react' } });

		expect(ids).toStrictEqual([]);
	});
});
