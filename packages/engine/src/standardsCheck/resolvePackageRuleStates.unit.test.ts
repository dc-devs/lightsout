import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig, StandardsSeverity } from '@/contracts';
import { resolvePackageRuleStates } from '@/standardsCheck';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${overrides.id}/fixtures`,
	...overrides,
});

const standardsPackage = ({ name = 'acme', rules }: { name?: string; rules: LoadedStandardsRule[] }): LoadedStandardsPackage => ({
	name,
	formatVersion: 1,
	rootPath: `/packages/${name}`,
	documents: [],
	rules,
});

const baseConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false as const } };

const setupStates = ({ packages, standardsChecks }: { packages: LoadedStandardsPackage[]; standardsChecks?: Record<string, unknown> }) => {
	const config = LightsoutConfig.parse(standardsChecks === undefined ? baseConfig : { ...baseConfig, 'standards-checks': standardsChecks });

	return { states: resolvePackageRuleStates({ packages, config }) };
};

const twoRules = [
	rule({ id: 'clone', defaultSeverity: StandardsSeverity.Advisory, defaultSettings: { minTokens: 50 } }),
	rule({ id: 'module-boundary', defaultSeverity: StandardsSeverity.Blocking }),
];

describe('resolvePackageRuleStates', () => {
	test('a rule the config never names keeps the severity and settings its own front matter declared', () => {
		const { states } = setupStates({ packages: [standardsPackage({ rules: twoRules })] });

		expect(states.get('clone')).toStrictEqual({ severity: StandardsSeverity.Advisory, settings: { minTokens: 50 }, fromConfig: false });
		expect(states.get('module-boundary')).toStrictEqual({ severity: StandardsSeverity.Blocking, settings: {}, fromConfig: false });
	});

	test('a bare severity string replaces the severity and leaves the settings alone', () => {
		const { states } = setupStates({ packages: [standardsPackage({ rules: twoRules })], standardsChecks: { clone: 'off' } });

		expect(states.get('clone')).toStrictEqual({ severity: StandardsSeverity.Off, settings: { minTokens: 50 }, fromConfig: true });
	});

	test('an object override merges its settings over the front matter rather than replacing them', () => {
		const { states } = setupStates({
			packages: [
				standardsPackage({ rules: [rule({ id: 'size-file', defaultSeverity: StandardsSeverity.Blocking, defaultSettings: { file: 250, tsxFile: 300 } })] }),
			],
			standardsChecks: { 'size-file': { settings: { file: 400 } } },
		});

		expect(states.get('size-file')).toStrictEqual({ severity: StandardsSeverity.Blocking, settings: { file: 400, tsxFile: 300 }, fromConfig: true });
	});

	test('an override carrying both a severity and settings applies both', () => {
		const { states } = setupStates({
			packages: [standardsPackage({ rules: twoRules })],
			standardsChecks: { clone: { severity: 'blocking', settings: { minTokens: 80 } } },
		});

		expect(states.get('clone')).toStrictEqual({ severity: StandardsSeverity.Blocking, settings: { minTokens: 80 }, fromConfig: true });
	});

	test('an empty object override changes nothing but still marks the rule as named by the config', () => {
		const { states } = setupStates({ packages: [standardsPackage({ rules: twoRules })], standardsChecks: { clone: {} } });

		// `--list` prints "(config)" from this flag, so naming a rule at all has to show up there
		expect(states.get('clone')).toStrictEqual({ severity: StandardsSeverity.Advisory, settings: { minTokens: 50 }, fromConfig: true });
	});

	test('the resolved settings are a copy, so editing them cannot reach back into the loaded package', () => {
		const rules = [rule({ id: 'clone', defaultSettings: { minTokens: 50 } })];
		const { states } = setupStates({ packages: [standardsPackage({ rules })] });
		const resolved = states.get('clone')?.settings ?? {};

		resolved.minTokens = 999;

		expect(rules[0]?.defaultSettings).toStrictEqual({ minTokens: 50 });
	});

	test('rules from several packages all get a state', () => {
		const states = resolvePackageRuleStates({
			packages: [standardsPackage({ rules: twoRules }), standardsPackage({ name: 'house-style', rules: [rule({ id: 'no-default-export' })] })],
		});

		expect([...states.keys()].sort()).toStrictEqual(['clone', 'module-boundary', 'no-default-export']);
		expect([...states.values()].every((state) => state.fromConfig === false)).toBe(true);
	});

	test('two packages claiming one rule id is refused, naming both', () => {
		const packages = [standardsPackage({ rules: twoRules }), standardsPackage({ name: 'house-style', rules: [rule({ id: 'clone' })] })];

		// ambiguous ids would make config overrides and site keys mean two things
		expect(() => resolvePackageRuleStates({ packages })).toThrow(/duplicate rule id "clone".*"acme".*"house-style"/);
	});

	test('a config naming a rule no package declares is refused, with the valid ids listed', () => {
		expect(() => setupStates({ packages: [standardsPackage({ rules: twoRules })], standardsChecks: { 'clone-detector': 'off' } })).toThrow(
			/standards-checks names "clone-detector".*valid rule ids: clone, module-boundary/,
		);
	});

	test('resolves every rule to its own default when the repo has no config at all', () => {
		const states = resolvePackageRuleStates({ packages: [standardsPackage({ rules: twoRules })] });

		expect(states.size).toBe(2);
		expect(states.get('clone')?.fromConfig).toBe(false);
	});
});
