import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { parsePlan } from '#src/plan/index.ts';
import { checkRenames } from '#src/plan/lint/checkRenames.ts';
import { type PhaseSpec, phaseBody } from '#tests/helpers/phasePlan.ts';

/** The phase file every case labels its findings with. */
const phase = 'phase1-demo.md';

/** One well-formed Acceptance Tests row, appended when a case wants the plan to state one. */
const ledgerSection = `
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| the parser reads a row | \`src/parse.unit.test.ts\` | reads a row | test |
`;

/**
 * A phase file built from `spec`, with any raw sections appended after it — the
 * way a case writes a Renames bullet the helper cannot render, or a ledger row —
 * parsed as the lint parses it, and the 1-based line a given text first sits at.
 */
const setupPlan = ({ spec = {}, appended = '' }: { spec?: PhaseSpec; appended?: string } = {}) => {
	const content = `${phaseBody(spec)}${appended}`;
	const plan = parsePlan({ content, base: phase });
	const lineOf = ({ text }: { text: string }) => content.split('\n').findIndex((line) => line.includes(text)) + 1;

	return { plan, lineOf };
};

/** Each finding as the fields the cases assert on; the issue and fix wording is human-facing and left free. */
const reported = ({ plan }: { plan: ReturnType<typeof parsePlan> }) =>
	checkRenames({ plan, phase }).map(({ check, severity, phase: label, location }) => ({ check, severity, phase: label, location }));

describe('checkRenames', () => {
	test('checkRenames: a well-formed rename-only plan and a plan with no Renames section are both silent', () => {
		const { plan: renameOnly } = setupPlan({
			spec: {
				modify: ['src/alpha.ts'],
				renames: [
					{ from: 'alpha', to: 'omega' },
					{ from: 'beta', to: 'gamma' },
				],
			},
		});
		const { plan: noRenames } = setupPlan({ spec: { create: ['src/parse.ts'] }, appended: ledgerSection });

		const findings = [renameOnly, noRenames].map((plan) => reported({ plan }));

		expect(findings).toStrictEqual([[], []]);
	});

	test('checkRenames: a malformed bullet and a rename to the same text are each one blocking finding at their line', () => {
		const { plan, lineOf } = setupPlan({
			spec: { modify: ['src/alpha.ts'] },
			appended: '\n## Renames\n\n- `alpha` → `omega`\n- `lonely` has no partner\n- `delta` → `delta`\n',
		});

		const findings = reported({ plan });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.RenamesWellFormed,
				severity: FindingSeverity.Blocking,
				phase,
				location: `${phase}:${lineOf({ text: '`lonely`' })}`,
			},
			{
				check: StructuralCheck.RenamesWellFormed,
				severity: FindingSeverity.Blocking,
				phase,
				location: `${phase}:${lineOf({ text: '`delta`' })}`,
			},
		]);
	});

	test('checkRenames: a rename whose new text contains an old text is refused, since applying the renames twice would change the result', () => {
		const { plan: ownOverlap, lineOf } = setupPlan({ spec: { modify: ['src/foo.ts'], renames: [{ from: 'foo', to: 'fooBar' }] } });
		const { plan: otherOverlap, lineOf: otherLineOf } = setupPlan({
			spec: {
				modify: ['src/alpha.ts'],
				renames: [
					{ from: 'alpha', to: 'omega' },
					{ from: 'beta', to: 'alphaNew' },
				],
			},
		});
		const { plan: disjoint } = setupPlan({
			spec: {
				modify: ['src/alpha.ts'],
				renames: [
					{ from: 'alpha', to: 'omega' },
					{ from: 'beta', to: 'gamma' },
				],
			},
		});

		const findings = [ownOverlap, otherOverlap, disjoint].map((plan) => reported({ plan }));

		expect(findings).toStrictEqual([
			[
				{
					check: StructuralCheck.RenamesWellFormed,
					severity: FindingSeverity.Blocking,
					phase,
					location: `${phase}:${lineOf({ text: '`fooBar`' })}`,
				},
			],
			[
				{
					check: StructuralCheck.RenamesWellFormed,
					severity: FindingSeverity.Blocking,
					phase,
					location: `${phase}:${otherLineOf({ text: '`alphaNew`' })}`,
				},
			],
			[],
		]);
	});

	test('checkRenames: a rename-only plan that creates a file or states an acceptance-test row is refused', () => {
		const renames = [{ from: 'alpha', to: 'omega' }];
		const { plan: creates } = setupPlan({ spec: { modify: ['src/alpha.ts'], create: ['src/omega.ts'], renames } });
		const { plan: statesRow } = setupPlan({ spec: { modify: ['src/alpha.ts'], renames }, appended: ledgerSection });

		const findings = [creates, statesRow].map((plan) => reported({ plan }));

		expect(findings).toStrictEqual([
			[
				{
					check: StructuralCheck.RenamesWellFormed,
					severity: FindingSeverity.Blocking,
					phase,
					location: `${phase} → Renames`,
				},
			],
			[
				{
					check: StructuralCheck.RenamesWellFormed,
					severity: FindingSeverity.Blocking,
					phase,
					location: `${phase} → Renames`,
				},
			],
		]);
	});
});
