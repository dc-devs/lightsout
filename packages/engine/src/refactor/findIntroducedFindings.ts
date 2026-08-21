import type { StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';

interface Params {
	/** What the work set out to leave standing — the run's frozen work-list, or a batch's pre-edit review. */
	frozen: StandardsFinding[];
	/** The re-check taken after the work landed. */
	live: StandardsFinding[];
	/** Which severity is being compared: blocking at the run's close, advisory at a batch's. */
	severity: StandardsSeverity;
}

/**
 * The findings some work left behind that it never set out to fix.
 *
 * A frozen finding still standing is a decline: a judgment the human rules on,
 * and it is reported as such rather than failed. One that was NOT frozen is
 * different in kind — the work made it. Trading a finding for a fresh one burns
 * nothing down, and calling that a pass teaches the gate to lie.
 *
 * Both levels of the run ask this same question. The closing whole-scope
 * re-check asks it of BLOCKING findings, where the answer fails the run. A
 * batch asks it of the ADVISORY findings its own edits introduced, where the
 * answer is handed back to the agent to judge — which is why the severity is a
 * parameter and not a constant: the comparison is one idea, the consequence
 * belongs to the caller.
 *
 * Matched on site key, which is the rule id plus the sorted file paths it
 * reports. No line numbers ride in it, so an edit above a site cannot re-mint
 * the key and make an untouched finding look introduced.
 */
export const findIntroducedFindings = ({ frozen, live, severity }: Params): StandardsFinding[] => {
	const frozenSiteKeys = new Set(frozen.map((finding) => finding.siteKey));

	return live.filter((finding) => finding.severity === severity && !frozenSiteKeys.has(finding.siteKey));
};
