import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';

interface Params {
	findings: StandardsFinding[];
	/** Repo-relative files this run changed. */
	changedFiles: string[];
}

/**
 * The refactor step's deterministic work-list, filtered to findings that
 * touch at least one file the run changed. Pre-existing debt in untouched
 * files never appears, and the committed baseline (when present) has already
 * suppressed accepted debt inside the changed files.
 *
 * Severity is the only gate lever. A `finding` on a changed file is
 * must-address and blocks the run; an `advisory` is a judgment call the agent
 * is handed and never blocks. There is no allow-list of blockable rules: one
 * that is off by default and needs remembering to switch on never gets
 * switched on, so a repo that wants a rule to stop blocking writes one
 * explicit line in its committed `standards-checks` config instead.
 */
export const selectStandardsFindings = ({ findings, changedFiles }: Params): { workList: StandardsFinding[]; advisories: StandardsFinding[] } => {
	const changed = new Set(changedFiles);

	// A finding's site is usually a file, and then equality is the whole
	// question. Some rules judge a FOLDER instead — `folder-census` reports on
	// `src/appUI`, not on anything inside it — and a changed-file list holds
	// files, so such a site could never equal an entry and the rule could never
	// gate a run however blocking it was declared. A folder counts as changed
	// when the run changed a file under it.
	//
	// The `/` matters: it makes this containment rather than string prefixing,
	// so `src/app` never claims a change inside `src/appUI`.
	const isChanged = (path: string) => changed.has(path) || changedFiles.some((file) => file.startsWith(`${path}/`));
	const touchesChanged = (finding: StandardsFinding) => finding.files.some((file) => isChanged(file.path));

	return {
		workList: findings.filter((finding) => finding.severity === StandardsSeverity.Blocking && touchesChanged(finding)),
		advisories: findings.filter((finding) => finding.severity === StandardsSeverity.Advisory && touchesChanged(finding)),
	};
};
