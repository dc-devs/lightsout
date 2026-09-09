import type { StandardsFinding } from '#src/contracts/index.ts';
import type { AttributedFindings } from '#src/standardsCheck/common/types/AttributedFindings.ts';

interface Params {
	/** The live check's findings, already filtered to the run's changed files. */
	live: StandardsFinding[];
	/** The pre-edit baseline's findings, or undefined when the run has none. */
	baseline: StandardsFinding[] | undefined;
}

/**
 * Where each live finding came from: this run's own edits, or the tree it
 * started from.
 *
 * Matched on site key, which is the rule id plus the sorted file paths it
 * reports. No line number rides in it, so an edit above a site cannot re-mint
 * the key and make an untouched finding read as introduced.
 *
 * A measured comparison needs a number on BOTH sides. A one-sided `measure` —
 * and every finding at all when the run has no baseline to read — is an absence
 * of evidence, not evidence of growth, so it lands in `uncertain` rather than
 * being guessed at. Only `introduced` and `worsened` are ever handed back as
 * work; the other two are recorded.
 *
 * Changed-file containment is not this helper's job. It is a second filter over
 * the set `selectStandardsFindings` already produced — a folder still counts as
 * changed when a file under it changed, and this is what then keeps that
 * folder's pre-existing finding out of the work list.
 */
export const attributeStandardsFindings = ({ live, baseline }: Params): AttributedFindings => {
	const attributed: AttributedFindings = { introduced: [], worsened: [], inherited: [], uncertain: [] };

	if (baseline === undefined) {
		return { ...attributed, uncertain: [...live] };
	}

	const before = new Map(baseline.map((finding) => [finding.siteKey, finding]));

	for (const finding of live) {
		const previous = before.get(finding.siteKey);

		if (previous === undefined) {
			attributed.introduced.push(finding);
		} else if (finding.measure === undefined || previous.measure === undefined) {
			attributed.uncertain.push(finding);
		} else if (finding.measure > previous.measure) {
			attributed.worsened.push(finding);
		} else {
			attributed.inherited.push(finding);
		}
	}

	return attributed;
};
