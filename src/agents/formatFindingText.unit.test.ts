import { expect, describe, test } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { formatFindingText } from '@/agents';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.Size,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: "function 'one' is 114 lines (cap ~80)",
	...overrides,
});

describe('formatFindingText', () => {
	test('carries the guidance alongside the measurement, because a lone number tells an agent nothing', () => {
		const text = formatFindingText({
			finding: finding({ guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.' }),
		});

		// without this the refactor agent reads "114 lines" with no exemption rule
		// and rewrites the orchestration the rule meant to spare
		expect(text).toBe("function 'one' is 114 lines (cap ~80) — Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.");
	});

	test('a rule with nothing to advise contributes no trailing separator', () => {
		expect(formatFindingText({ finding: finding() })).toBe("function 'one' is 114 lines (cap ~80)");
	});
});
