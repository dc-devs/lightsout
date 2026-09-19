import { describe, expect, test } from '@jest/globals';
import { checkHandoffDeclared } from '#src/plan/lint/index.ts';
import { overviewBody, phaseBody, phaseFile } from '#tests/helpers/phasePlan.ts';

/** One implementable phase file whose `## What Next Plan Expects` carries exactly the given body. */
const setupPhase = ({ handsForward, base = 'phase1-core.md' }: { handsForward: string; base?: string }) => {
	const { plan } = phaseFile({ base, body: phaseBody({ handsForward }) });

	return { params: { plan, phase: base } };
};

/** The same phase with its hand-off heading renamed out of existence — the absence `sections-present` already owns. */
const setupWithoutSection = ({ base = 'phase1-core.md' }: { base?: string } = {}) => {
	const body = phaseBody({ handsForward: '- `buildCore` exists.' }).replace('## What Next Plan Expects', '## Removed What Next Plan Expects');
	const { plan } = phaseFile({ base, body });

	return { params: { plan, phase: base } };
};

/**
 * The overview, carrying a hand-off section written as prose. Only the variant
 * rule can spare it, so a check that ignored the variant would report it.
 */
const setupOverview = () => {
	const base = 'overview.md';
	const body = `${overviewBody({ rows: [{ file: 'phase1-core.md' }] })}
## What Next Plan Expects

The phases below carry the work forward.
`;
	const { plan } = phaseFile({ base, body });

	return { params: { plan, phase: base } };
};

describe('checkHandoffDeclared', () => {
	test('checkHandoffDeclared: a comparable token in What Next Plan Expects raises nothing', () => {
		const path = setupPhase({ handsForward: '- `packages/engine/src/plan/index.ts` re-exports it.' });
		const identifier = setupPhase({ handsForward: '- `buildCore` exists.' });

		const checked = {
			path: checkHandoffDeclared(path.params),
			identifier: checkHandoffDeclared(identifier.params),
		};

		expect(checked).toStrictEqual({ path: [], identifier: [] });
	});

	test('checkHandoffDeclared: a hand-off written as prose with no name blocks', () => {
		const { params } = setupPhase({ handsForward: 'The next phase builds on this one, once the groundwork is laid.' });

		const findings = checkHandoffDeclared(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'handoff-declared',
				severity: 'blocking',
				phase: 'phase1-core.md',
				location: expect.stringContaining('phase1-core.md'),
			}),
		]);
	});

	test("checkHandoffDeclared: a line whose first word is the template's none sentinel declares an absence", () => {
		const bare = setupPhase({ handsForward: 'None' });
		const bulleted = setupPhase({ handsForward: '- none' });
		const trailing = setupPhase({ handsForward: '- None — final phase.' });
		const prose = setupPhase({ handsForward: '- Nothing much, the next phase reads the same files.' });

		const checked = {
			bare: checkHandoffDeclared(bare.params).map((finding) => finding.check),
			bulleted: checkHandoffDeclared(bulleted.params).map((finding) => finding.check),
			trailing: checkHandoffDeclared(trailing.params).map((finding) => finding.check),
			prose: checkHandoffDeclared(prose.params).map((finding) => finding.check),
		};

		expect(checked).toStrictEqual({ bare: [], bulleted: [], trailing: [], prose: ['handoff-declared'] });
	});

	test('checkHandoffDeclared: an overview and a file with no hand-off section are left to the checks that own them', () => {
		const overview = setupOverview();
		const missing = setupWithoutSection();

		const checked = {
			overview: checkHandoffDeclared(overview.params),
			missing: checkHandoffDeclared(missing.params),
		};

		expect(checked).toStrictEqual({ overview: [], missing: [] });
	});

	test('checkHandoffDeclared: a span that is neither a path nor a bare identifier does not satisfy the check', () => {
		const { params } = setupPhase({ handsForward: '- `provenance.createdBy` and `created-files-within-ceiling` move on.' });

		const findings = checkHandoffDeclared(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'handoff-declared',
				severity: 'blocking',
				phase: 'phase1-core.md',
			}),
		]);
	});
});
