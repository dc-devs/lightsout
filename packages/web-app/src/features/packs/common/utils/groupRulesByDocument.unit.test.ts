import { describe, expect, test } from '@jest/globals';
import type { StandardsPackRuleListing } from '@lightsout/engine';
import { groupRulesByDocument } from '#src/features/packs/common/utils/groupRulesByDocument.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';

const allRules = [
	buildStandardsPackRuleListing({ id: 'type-assertion', documentPath: 'code/style-guide/typescript/type-assertions' }),
	buildStandardsPackRuleListing({ id: 'explicit-return-type', documentPath: 'code/style-guide/typescript/return-types' }),
	buildStandardsPackRuleListing({ id: 'object-args', documentPath: 'code/style-guide/patterns/functions' }),
];

const setupGroupRulesByDocument = ({ rules = allRules }: { rules?: StandardsPackRuleListing[] } = {}) => {
	const pack = buildStandardsPackView({ rules: allRules });

	return { groups: groupRulesByDocument({ documents: pack.documents, rules }) };
};

describe('groupRulesByDocument', () => {
	test('keeps the documents in the order the pack assembles them, which is the reading order its author chose', () => {
		const { groups } = setupGroupRulesByDocument();

		expect(groups.map((group) => group.document.path)).toStrictEqual([
			'code/style-guide/typescript/type-assertions',
			'code/style-guide/typescript/return-types',
			'code/style-guide/patterns/functions',
		]);
	});

	test("orders each document's rules by its own list rather than by anything the caller passed", () => {
		const pack = buildStandardsPackView({
			rules: [buildStandardsPackRuleListing({ id: 'first' }), buildStandardsPackRuleListing({ id: 'second' })],
		});

		const groups = groupRulesByDocument({ documents: pack.documents, rules: [...pack.rules].reverse() });

		expect(groups[0].rules.map((rule) => rule.id)).toStrictEqual(['first', 'second']);
	});

	test('drops a document whose rules were all filtered away, so a run of empty headings never appears', () => {
		const { groups } = setupGroupRulesByDocument({ rules: [allRules[2]] });

		expect(groups.map((group) => group.document.path)).toStrictEqual(['code/style-guide/patterns/functions']);
	});

	test('answers with nothing at all when no rule survived, which is the state the page owns an empty line for', () => {
		const { groups } = setupGroupRulesByDocument({ rules: [] });

		expect(groups).toStrictEqual([]);
	});

	test('drops a rule no document claims rather than inventing a group to hold it', () => {
		const { groups } = setupGroupRulesByDocument({ rules: [...allRules, buildStandardsPackRuleListing({ id: 'orphan', documentPath: 'code/nowhere' })] });

		expect(groups.flatMap((group) => group.rules.map((rule) => rule.id))).toStrictEqual(['type-assertion', 'explicit-return-type', 'object-args']);
	});
});
