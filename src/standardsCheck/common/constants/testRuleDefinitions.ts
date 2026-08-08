import { StandardsPassId, StandardsRule, StandardsSeverity } from '@/contracts';
import type { StandardsRuleDefinition } from '@/standardsCheck/common/types/StandardsRuleDefinition';

/**
 * The registry entries for every rule drawn from a `standards/tests/…`
 * document — how a test file is written and where it sits.
 *
 * Membership follows the `doc` a rule names, not the pass that emits it, which
 * is why `test-only-export` is here rather than beside its pass-mates in
 * `codeRuleDefinitions`: the rule it enforces is a testing rule.
 * `standardsRuleRegistry` composes the two halves and is where the compiler
 * checks that every rule has an entry.
 */
export const testRuleDefinitions = {
	[StandardsRule.TestOnlyExport]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'an export only its own tests reference',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.DeadExports,
		needsTypescript: false,
	},
	[StandardsRule.TestMockPrefix]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a module-scope mock variable without the `mock` prefix Jest hoisting needs',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestMockReturnInHook]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a mock return value set in a beforeEach instead of the setup factory',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestMockUntyped]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a `jest.fn()` with no generic, so the spy does not match the real signature',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestMockWrapperUntyped]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a `jest.mock` factory wrapper that discards the arguments it is called with',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestSharedLet]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a `let` reassigned in a beforeEach — mutable state shared across tests',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestAssertInHook]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'an assertion in a beforeEach instead of the test body',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestNestedDescribe]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a nested `describe` outside the `when …` / `for …` exception',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestManualMockCleanup]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'manual mock cleanup in a lifecycle hook, which the Jest config already does',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestStrictEqualMatcher]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: '`toStrictEqual` with an asymmetric matcher — strict in name only',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestMultipleSetups]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'more than one setup factory call in one test',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
	},
	[StandardsRule.TestMegaFactory]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a setup factory grown past its parameter cap',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.TestShape,
		needsTypescript: false,
		defaultSettings: { maxParams: 6 },
	},
	[StandardsRule.PathTestInTestsFolder]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a unit test in a separate tests directory instead of beside its subject',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathTestNotColocated]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'a co-located test whose first name segment names no source file in its folder',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathTestSupportInSrc]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'shared test fixtures or mocks living under `src/`',
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathTestUntestedSubjectNotPublic]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: "a test file whose subject its module's barrel does not export",
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
} satisfies Record<string, StandardsRuleDefinition>;
