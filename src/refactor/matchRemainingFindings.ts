import type { StandardsFinding } from '@/contracts';

interface Params {
	/** The batch's frozen findings — the identities being checked for survival. */
	frozen: StandardsFinding[];
	/** The live re-check's findings. */
	live: StandardsFinding[];
}

/**
 * Which frozen findings still exist in a live check, matched on site key alone.
 *
 * There is no per-rule special case any more: a key is the rule id plus the
 * sorted file paths it reports, so none embeds a line number that an edit above
 * the site could re-mint. The clone rule used to need its own path-set
 * comparison for exactly that reason, and no longer does.
 */
export const matchRemainingFindings = ({ frozen, live }: Params): string[] => {
	const liveSiteKeys = new Set(live.map((finding) => finding.siteKey));

	return frozen.filter((finding) => liveSiteKeys.has(finding.siteKey)).map((finding) => finding.siteKey);
};
