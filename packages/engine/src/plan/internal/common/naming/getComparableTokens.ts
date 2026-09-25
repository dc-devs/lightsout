import { basename } from 'node:path';
import { planSentinelTokens } from '#src/plan/internal/common/constants/planSentinelTokens.ts';
import { isPathToken } from '#src/plan/internal/common/paths/isPathToken.ts';
import { getCodeSpans } from '#src/plan/internal/common/utils/getCodeSpans.ts';

interface Params {
	/** The lines to reduce — one section's body, or a whole plan file's text. */
	lines: string[];
}

/** A span that is exactly one bare identifier — no dots, hyphens, calls, type expressions or spaces. */
const isIdentifierSpan = ({ span }: { span: string }) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span);

/**
 * A set of plan lines reduced to the tokens a hand-off is compared by, each
 * mapped to the spelling the lines used — so a caller reporting a finding quotes
 * the author's own words rather than the reduced token. A caller wanting only
 * the token set reads `new Set(map.keys())`.
 *
 * Only two span shapes are comparable, and every other span and all prose is
 * ignored, so a comparison built on this is exactly decidable rather than a
 * sentence diff:
 *
 * - **A path span** — contains `/` and ends in a `.<ext>`. It reduces to its
 *   **basename**, not its verbatim text: this repo's plans spell the same file
 *   both repo-relative (`packages/engine/src/plan/index.ts`) and through a
 *   package alias (`#src/plan/index.ts`), and a verbatim comparison would report
 *   a hand-off as broken purely because the two phases chose different
 *   spellings. The basename is alias-proof, needs no import-map resolution, and
 *   a plan that genuinely hands forward two different files with the same
 *   basename is already ambiguous prose the human should fix.
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
 * Spelled once because the phase graph and the checks reading it must never
 * disagree about which spans are names: a token one counts and another does not
 * makes them read the same line two ways with no error anywhere.
 */
export const getComparableTokens = ({ lines }: Params): Map<string, string> => {
	const tokens = new Map<string, string>();

	for (const line of lines) {
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
