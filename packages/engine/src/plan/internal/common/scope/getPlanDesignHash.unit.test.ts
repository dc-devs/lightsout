import { describe, expect, test } from '@jest/globals';
import { getPlanDesignHash } from '#src/plan/internal/common/scope/getPlanDesignHash.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

// A design hash answers one question: what text did a reader of this plan file
// actually read? So every test here compares two hashes rather than pinning a
// digest — what the function promises is which edits move the value and which
// leave it where it was.

/**
 * One plan file carrying two engine-composed regions — `## Decision Log` and
 * `## Global Constraints` — between authored sections, so an edit can be aimed
 * inside a generated region or outside every one of them.
 */
const setupPlan = ({
	context = 'The shared design text this file states in its own words.',
	logRow = 'Record the reading rather than re-buying it',
	constraint = 'The grading machinery is restructured, not patched around',
}: {
	context?: string;
	logRow?: string;
	constraint?: string;
} = {}) =>
	parsePlan({
		base: 'phase1-design.md',
		content: `# Design Hash — Phase 1

## Context

${context}

## Decision Log

| # | Choice |
|---|--------|
| 1 | ${logRow} |

## Global Constraints

- ${constraint}

## Scope Boundaries

Do the work this phase names and nothing beside it.
`,
	});

/**
 * A plan file whose very last line ends in `ending`, so a fragment can be moved
 * across the boundary between the file's design text and the text attributed to
 * it without either side gaining or losing a character.
 */
const setupSplitPlan = ({ ending }: { ending: string }) =>
	parsePlan({
		base: 'phase1-design.md',
		content: `# Design Hash — Phase 1

## Context

The shared design text this file states in its own words.

## Decision Log

| # | Choice |
|---|--------|
| 1 | Record the reading rather than re-buying it |

## Scope Boundaries

Do the work this phase names: ${ending}`,
	});

describe('getPlanDesignHash', () => {
	test('an edit inside a generated region leaves the design hash unmoved and an edit outside one moves it', () => {
		const plan = setupPlan();
		const generatedEdit = setupPlan({ logRow: 'Rewritten by a sync of the saved decision record' });
		const designEdit = setupPlan({ context: 'The shared design text, rewritten by the plan author.' });

		const asWritten = getPlanDesignHash({ plan });
		const afterGeneratedEdit = getPlanDesignHash({ plan: generatedEdit });
		const afterDesignEdit = getPlanDesignHash({ plan: designEdit });

		expect(afterGeneratedEdit).toBe(asWritten);
		expect(afterDesignEdit).not.toBe(asWritten);
	});

	test('attributed text is part of the hash, so two files with identical design text hash apart', () => {
		const plan = setupPlan();
		const sameDesign = setupPlan();

		const withOwnRow = getPlanDesignHash({ plan, attributed: '| 1 | `phase1-design.md` | the core of the change |' });
		const withOtherRow = getPlanDesignHash({ plan: sameDesign, attributed: '| 2 | `phase2-design.md` | the rest of the change |' });
		const withSameRow = getPlanDesignHash({ plan: sameDesign, attributed: '| 1 | `phase1-design.md` | the core of the change |' });

		expect(withOwnRow).not.toBe(withOtherRow);
		expect(withSameRow).toBe(withOwnRow);
	});

	test('a design text and an attributed text that concatenate identically still hash apart', () => {
		const shorterDesign = setupSplitPlan({ ending: 'alpha' });
		const longerDesign = setupSplitPlan({ ending: 'alphabeta' });

		const splitEarly = getPlanDesignHash({ plan: shorterDesign, attributed: 'betagamma' });
		const splitLate = getPlanDesignHash({ plan: longerDesign, attributed: 'gamma' });

		expect(splitEarly).not.toBe(splitLate);
	});

	test('a kept generated region is measured and the same region unkept is not', () => {
		const plan = setupPlan();
		const constraintEdit = setupPlan({ constraint: 'The grading machinery is patched around after all' });

		const keptAsWritten = getPlanDesignHash({ plan, keepRegions: ['Global Constraints'] });
		const keptAfterEdit = getPlanDesignHash({ plan: constraintEdit, keepRegions: ['Global Constraints'] });
		const unkeptAsWritten = getPlanDesignHash({ plan });
		const unkeptAfterEdit = getPlanDesignHash({ plan: constraintEdit });

		expect(keptAfterEdit).not.toBe(keptAsWritten);
		expect(unkeptAfterEdit).toBe(unkeptAsWritten);
	});
});
