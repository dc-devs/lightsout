import { collapseText } from '#src/plan/common/memory/collapseText.ts';
import { citationPathToken } from '#src/plan/common/paths/citationPathToken.ts';
import { citedPathExists } from '#src/plan/common/paths/citedPathExists.ts';

interface Params {
	cwd: string;
	/** The judge's `answerAt`. */
	citation: string;
	/** The plan text the citation must be found in when it is not a path. */
	planText: string;
}

/** Confirmed, or refused with the reason a human reads at the terminal. */
type CitationCheck = { ok: true } | { ok: false; reason: string };

/**
 * Long enough that a heading alone (`## Decision Log`) cannot close a record,
 * short enough that one Decision Log cell can. Declared here because this is its
 * only consumer, and stated through the function's behaviour by its test rather
 * than by importing the number.
 */
const minimumCitationLength = 24;

/** A path-shaped citation confirmed, or refused in the words `matchGapVerdicts` refuses the same evidence in. */
const confirmPath = async ({ cwd, token }: { cwd: string; token: string }): Promise<CitationCheck> => {
	const present = await citedPathExists({ cwd, token });

	return present ? { ok: true } : { ok: false, reason: `cited ${token}, which is not on disk` };
};

/** Whether a quoted citation is really a line of the plan, and long enough to settle anything. */
const confirmQuote = ({ citation, planText }: { citation: string; planText: string }): CitationCheck => {
	const quote = collapseText({ text: citation });

	if (quote.length < minimumCitationLength) {
		return { ok: false, reason: `citation shorter than ${minimumCitationLength} characters: ${citation}` };
	}

	const found = collapseText({ text: planText }).includes(quote);

	return found ? { ok: true } : { ok: false, reason: `citation not found in the plan text: ${citation}` };
};

/**
 * Whether a judge's citation is evidence the engine can check, in the two forms
 * a citation takes.
 *
 * A path — everything `citationPathToken` recognises as one — is checked against
 * the repository. Anything else must be a verbatim quote of the plan text the
 * judge was handed, matched after collapsing whitespace and case.
 *
 * It exists because the one thing a cheaper grading pass must never do is turn
 * an unresolved blocker into an approval, and an invented citation is exactly
 * that. A verbatim-quote rule is the one match the engine can make without
 * guessing what the judge meant.
 */
export const confirmCitation = async ({ cwd, citation, planText }: Params): Promise<CitationCheck> => {
	const token = citationPathToken({ citation });

	return token === undefined ? confirmQuote({ citation, planText }) : confirmPath({ cwd, token });
};
