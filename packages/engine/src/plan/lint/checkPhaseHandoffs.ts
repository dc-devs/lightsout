import { basename } from 'node:path';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { planSentinelTokens } from '#src/plan/common/constants/planSentinelTokens.ts';
import { isPathToken } from '#src/plan/common/paths/isPathToken.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';

interface Params {
	/** Implementable plan files, ordered by phase number. */
	phases: PhaseFile[];
}

/** A span that is exactly one bare identifier — no dots, hyphens, calls, type expressions or spaces. */
const isIdentifierSpan = ({ span }: { span: string }) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span);

/**
 * A section's comparable tokens, mapped to the spelling the section used. A path
 * span reduces to its basename, so a file spelled repo-relative on one side and
 * through a package alias on the other still compares equal; an identifier span
 * compares verbatim. Everything else is prose and is ignored.
 */
const comparableTokens = ({ sectionLines }: { sectionLines: string[] }) => {
	const tokens = new Map<string, string>();

	for (const line of sectionLines) {
		for (const span of getCodeSpans({ line })) {
			if (planSentinelTokens.has(span)) {
				continue;
			}

			if (isPathToken({ token: span })) {
				tokens.set(basename(span), span);
			} else if (isIdentifierSpan({ span })) {
				tokens.set(span, span);
			}
		}
	}

	return tokens;
};

/**
 * HandoffChained — each phase's `## What Next Plan Expects` must be claimed by
 * the next phase's `## Prerequisites`. Only two span shapes are comparable, and
 * every other span and all prose is ignored, so the check is exactly decidable
 * rather than a sentence diff:
 *
 * - **A path span** — contains `/` and ends in a `.<ext>`. It is compared by its
 *   **basename**, not verbatim: this repo's plans spell the same file both
 *   repo-relative (`packages/engine/src/plan/index.ts`) and through a package
 *   alias (`#src/plan/index.ts`), and a verbatim comparison would report a
 *   hand-off as broken purely because the two phases chose different spellings.
 *   The basename is alias-proof, needs no import-map resolution, and a plan that
 *   genuinely hands forward two different files with the same basename is
 *   already ambiguous prose the human should fix.
 * - **A bare identifier span** — matches `^[A-Za-z_$][A-Za-z0-9_$]*$` end to
 *   end, compared verbatim. A dotted member span (`provenance.createdBy`), a
 *   hyphenated name (`created-files-within-ceiling`), a call (`parsePlan()`), a
 *   type expression (`Array<Result | undefined>`) and anything containing a
 *   space are all NOT identifiers and are ignored. Narrow on purpose: an export
 *   name is what crosses a phase boundary, and every wider shape is prose that
 *   would generate false alarms.
 *
 * The sentinel words the template defines as empty values — `none` and `None` —
 * are excluded even though they match the identifier shape, because they are a
 * declared absence rather than a name being handed over.
 *
 * Both sides are reduced to the same comparable-token set and the two sets are
 * compared; the receiving side is never searched as raw text, which would let an
 * identifier match inside a longer word and would count a path mentioned in
 * unrelated prose as a claim. A missing section on either side is already a
 * `sections-present` finding, so the pair is skipped rather than reported twice.
 *
 * Blocking, not advisory: the point of the check is that a mechanical hand-off
 * break never survives to the agent grade. The repair loop is capped at three
 * attempts, so a stubborn false positive surfaces to the human rather than
 * wedging a draft.
 *
 * The final phase is not checked forward: it has no successor, and the template
 * already has it state "None — final phase."
 */
export const checkPhaseHandoffs = ({ phases }: Params): StructuralFinding[] => {
	const findings: StructuralFinding[] = [];

	for (const [index, phase] of phases.slice(0, -1).entries()) {
		const next = phases[index + 1];
		const handedForward = phase.plan.sections.get('What Next Plan Expects');
		const claimed = next.plan.sections.get('Prerequisites');

		if (handedForward === undefined || claimed === undefined) {
			continue;
		}

		const claimedTokens = comparableTokens({ sectionLines: claimed });

		for (const [token, spelling] of comparableTokens({ sectionLines: handedForward })) {
			if (claimedTokens.has(token)) {
				continue;
			}

			findings.push({
				check: StructuralCheck.HandoffChained,
				severity: FindingSeverity.Blocking,
				phase: next.base,
				issue: `${phase.base} hands forward \`${spelling}\`, which this phase's Prerequisites never claim`,
				location: `${next.base} → Prerequisites`,
				fix: `name \`${spelling}\` in '## Prerequisites', or drop it from ${phase.base}'s '## What Next Plan Expects'`,
			});
		}
	}

	return findings;
};
