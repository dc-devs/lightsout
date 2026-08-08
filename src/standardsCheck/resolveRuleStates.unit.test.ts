import { expect, describe, test } from '@jest/globals';
import { LightsoutConfig, StandardsRule, StandardsSeverity } from '@/contracts';
import { resolveRuleStates } from '@/standardsCheck';

const baseConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false as const } };

const setupStates = ({ standardsChecks }: { standardsChecks?: Record<string, unknown> } = {}) => {
	const config = LightsoutConfig.parse(standardsChecks === undefined ? baseConfig : { ...baseConfig, standardsChecks });

	return { states: resolveRuleStates({ config }) };
};

describe('resolveRuleStates', () => {
	test('a rule the config never names keeps its own default severity and settings', () => {
		const { states } = setupStates();

		// silence is never a change
		expect(states.get(StandardsRule.Clone)).toStrictEqual({ severity: StandardsSeverity.Advisory, settings: { minTokens: 50 }, fromConfig: false });
		expect(states.get(StandardsRule.ModuleBoundary)).toStrictEqual({ severity: StandardsSeverity.Finding, settings: {}, fromConfig: false });
	});

	test('a bare severity string replaces the severity and leaves the settings alone', () => {
		const { states } = setupStates({ standardsChecks: { clone: 'off' } });

		expect(states.get(StandardsRule.Clone)).toStrictEqual({ severity: StandardsSeverity.Off, settings: { minTokens: 50 }, fromConfig: true });
	});

	test('an object with only a severity leaves the settings at their defaults', () => {
		const { states } = setupStates({ standardsChecks: { clone: { severity: 'finding' } } });

		expect(states.get(StandardsRule.Clone)).toStrictEqual({ severity: StandardsSeverity.Finding, settings: { minTokens: 50 }, fromConfig: true });
	});

	test('an object with only settings keeps the default severity and merges what it names', () => {
		const { states } = setupStates({ standardsChecks: { 'size-file': { settings: { file: 400 } } } });

		// tsxFile is untouched — a partial override is a merge, never a replacement
		expect(states.get(StandardsRule.SizeFile)).toStrictEqual({ severity: StandardsSeverity.Finding, settings: { file: 400, tsxFile: 300 }, fromConfig: true });
	});

	test('an object carrying both applies both', () => {
		const { states } = setupStates({ standardsChecks: { 'size-function': { severity: 'finding', settings: { function: 40 } } } });

		expect(states.get(StandardsRule.SizeFunction)).toStrictEqual({
			severity: StandardsSeverity.Finding,
			settings: { function: 40, hook: 160, component: 200 },
			fromConfig: true,
		});
	});

	test('a run with no config at all still resolves every rule to its default', () => {
		const states = resolveRuleStates({});

		// the standards check works with or without a lightsout.config.json
		expect(states.size).toBe(Object.values(StandardsRule).length);
		expect([...states.values()].every((state) => state.fromConfig === false)).toBe(true);
	});

	test('every rule in the closed list gets a state, named or not', () => {
		const { states } = setupStates({ standardsChecks: { clone: 'off' } });

		expect([...states.keys()].sort()).toStrictEqual([...Object.values(StandardsRule)].sort());
		// one named rule does not make the others policy
		expect([...states.values()].filter((state) => state.fromConfig).length).toBe(1);
	});
});
