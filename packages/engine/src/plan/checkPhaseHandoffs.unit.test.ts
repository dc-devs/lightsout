import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkPhaseHandoffs } from '#src/plan/index.ts';
import { phaseBody, phaseFile } from '#tests/helpers/phasePlan.ts';

/** Two consecutive phases: one hands names forward, the next claims them. */
const setupPair = ({ handsForward, prerequisites }: { handsForward: string; prerequisites: string }) => {
	const handing = phaseFile({ base: 'phase1-core.md', body: phaseBody({ handsForward }) });
	const claiming = phaseFile({ base: 'phase2-extra.md', body: phaseBody({ prerequisites }) });

	return { phases: [handing, claiming] };
};

/** The same pair with one required heading renamed out of existence — the case the sections check already owns. */
const setupTruncated = ({ heading }: { heading: string }) => {
	const cut = (body: string) => body.replace(`## ${heading}`, `## Removed ${heading}`);
	const handing = phaseFile({ base: 'phase1-core.md', body: cut(phaseBody({ handsForward: '- `buildCore` exists.' })) });
	const claiming = phaseFile({ base: 'phase2-extra.md', body: cut(phaseBody({ prerequisites: '- None' })) });

	return { phases: [handing, claiming] };
};

describe('checkPhaseHandoffs', () => {
	test('a name the next phase claims chains cleanly', () => {
		const { phases } = setupPair({ handsForward: '- `buildCore` exists.', prerequisites: '- `buildCore` exists.' });

		const findings = checkPhaseHandoffs({ phases });

		expect(findings).toStrictEqual([]);
	});

	test('a name the next phase never claims is a blocking finding on the file that must change', () => {
		const { phases } = setupPair({ handsForward: '- `buildCore` exists.', prerequisites: '- None' });

		const findings = checkPhaseHandoffs({ phases });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.HandoffChained,
				severity: FindingSeverity.Blocking,
				phase: 'phase2-extra.md',
				issue: "phase1-core.md hands forward `buildCore`, which this phase's Prerequisites never claim",
				location: 'phase2-extra.md → Prerequisites',
				fix: "name `buildCore` in '## Prerequisites', or drop it from phase1-core.md's '## What Next Plan Expects'",
			},
		]);
	});

	test('a path is compared by basename, so a package alias on one side still chains', () => {
		const { phases } = setupPair({
			handsForward: '- `packages/engine/src/plan/index.ts` re-exports it.',
			prerequisites: '- `#src/plan/index.ts` re-exports it.',
		});

		const findings = checkPhaseHandoffs({ phases });

		// the two spellings are the same file, and reporting them as a broken
		// hand-off would refuse a plan that is exactly right
		expect(findings).toStrictEqual([]);
	});

	test('an unclaimed path is named the way the handing phase spelled it', () => {
		const { phases } = setupPair({ handsForward: '- `packages/engine/src/plan/checkPhaseCount.ts` exists.', prerequisites: '- None' });

		const findings = checkPhaseHandoffs({ phases });

		// the comparison normalizes to a basename; the message must not, or a
		// human is asked to reverse the normalization to find the line
		expect(findings[0]?.issue).toContain('`packages/engine/src/plan/checkPhaseCount.ts`');
	});

	test('spans that are neither a path nor a bare identifier are prose and are ignored', () => {
		const { phases } = setupPair({
			handsForward: '- `provenance.createdBy`, `created-files-within-ceiling`, `parsePlan()`, `Array<Result | undefined>` and `two words`.',
			prerequisites: '- None',
		});

		const findings = checkPhaseHandoffs({ phases });

		// every wider shape is prose the check would only generate false alarms
		// over, got: ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('the sentinel words the template defines as empty values are a declared absence, not a name', () => {
		const { phases } = setupPair({ handsForward: '- `none`\n- `None`', prerequisites: '- None' });

		// identifier-shaped, but the template says these mean "nothing here" —
		// without the exclusion every empty bullet reads as an unclaimed hand-off
		expect(checkPhaseHandoffs({ phases })).toStrictEqual([]);
	});

	test('a missing What Next Plan Expects leaves the pair to the sections check', () => {
		const { phases } = setupTruncated({ heading: 'What Next Plan Expects' });

		expect(checkPhaseHandoffs({ phases })).toStrictEqual([]);
	});

	test('a missing Prerequisites leaves the pair to the sections check', () => {
		const { phases } = setupTruncated({ heading: 'Prerequisites' });

		// reporting it here too would show the same defect twice under two names
		expect(checkPhaseHandoffs({ phases })).toStrictEqual([]);
	});

	test('a single phase has no successor to be checked against', () => {
		const phases = [phaseFile({ base: 'plan.md', body: phaseBody({ handsForward: '- `buildCore` exists.' }) })];

		expect(checkPhaseHandoffs({ phases })).toStrictEqual([]);
	});

	test('a chain of three phases is checked pair by pair, never across a phase', () => {
		const phases = [
			phaseFile({ base: 'phase1-core.md', body: phaseBody({ handsForward: '- `alpha`' }) }),
			phaseFile({ base: 'phase2-mid.md', body: phaseBody({ prerequisites: '- `alpha`', handsForward: '- `beta`' }) }),
			phaseFile({ base: 'phase3-last.md', body: phaseBody({ prerequisites: '- `alpha`' }) }),
		];

		const findings = checkPhaseHandoffs({ phases });

		// phase 3 restating phase 1's name does not claim phase 2's — only the
		// consecutive pair is compared
		expect(findings.map(({ phase, issue }) => ({ phase, issue }))).toStrictEqual([
			{ phase: 'phase3-last.md', issue: "phase2-mid.md hands forward `beta`, which this phase's Prerequisites never claim" },
		]);
	});
});
