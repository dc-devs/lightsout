import { describe, expect, test } from '@jest/globals';
import type { StandardsPackRuleListing } from '@lightsout/engine';
import { getCapRules } from '#src/features/packs/common/utils/getCapRules.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';

const setupGetCapRules = ({ rules }: { rules: StandardsPackRuleListing[] }) => ({ caps: getCapRules({ rules }) });

describe('getCapRules', () => {
	test('reports every rule that ships a number, with the number it ships', () => {
		const { caps } = setupGetCapRules({ rules: [buildStandardsPackRuleListing({ id: 'file-size', defaultSettings: { maxLines: 250 } })] });

		expect(caps).toStrictEqual([{ id: 'file-size', settings: [{ name: 'maxLines', value: 250 }] }]);
	});

	test("reports all of a rule's numbers when it ships more than one", () => {
		const { caps } = setupGetCapRules({
			rules: [buildStandardsPackRuleListing({ id: 'function-size', defaultSettings: { maxLines: 50, maxComponentLines: 100 } })],
		});

		expect(caps[0].settings).toStrictEqual([
			{ name: 'maxLines', value: 50 },
			{ name: 'maxComponentLines', value: 100 },
		]);
	});

	test('leaves out the rules that ship no numbers, which is most of the pack', () => {
		const { caps } = setupGetCapRules({
			rules: [buildStandardsPackRuleListing({ id: 'type-assertion' }), buildStandardsPackRuleListing({ id: 'file-size', defaultSettings: { maxLines: 250 } })],
		});

		expect(caps.map((rule) => rule.id)).toStrictEqual(['file-size']);
	});

	test('answers with nothing for a pack that enforces no numbers, so the strip knows to render nothing', () => {
		const { caps } = setupGetCapRules({ rules: [buildStandardsPackRuleListing()] });

		expect(caps).toStrictEqual([]);
	});
});
