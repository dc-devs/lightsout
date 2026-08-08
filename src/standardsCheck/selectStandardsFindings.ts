import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';

/** Site-key prefixes with stable path-keyed identities — safe to gate on (size:file: and boundary: key on the path alone; per-function size and clone keys embed lines/names, so they inform the work-list but never block). Placement and barrel-star stay work-list, not gate, until they've been lived with. */
const gatingSiteKeyPattern = /^(ast:|multi-export:|size:file:|boundary:)/;

interface Params {
	findings: StandardsFinding[];
	/** Repo-relative files this run changed. */
	changedFiles: string[];
}

/**
 * The refactor step's deterministic work-list, filtered to findings that
 * touch at least one file the run changed. Pre-existing debt in untouched
 * files never appears, and the committed baseline (when present) has
 * already suppressed accepted debt inside the changed files. `workList` is
 * must-address; `advisories` are the size rule's judgment-carrying
 * items (function/hook/component caps with the orchestration exemption) —
 * sent to the agent to judge, never blocking; `gating` is the workList
 * subset the standards gate may block on.
 */
export const selectStandardsFindings = ({
	findings,
	changedFiles,
}: Params): { workList: StandardsFinding[]; advisories: StandardsFinding[]; gating: StandardsFinding[] } => {
	const changed = new Set(changedFiles);
	const touchesChanged = (finding: StandardsFinding) => finding.files.some((file) => changed.has(file.path));
	const workList = findings.filter((finding) => finding.severity === StandardsSeverity.Finding && touchesChanged(finding));
	const advisories = findings.filter(
		(finding) => finding.severity === StandardsSeverity.Advisory && finding.rule === StandardsRule.Size && touchesChanged(finding),
	);

	return { workList, advisories, gating: workList.filter((finding) => gatingSiteKeyPattern.test(finding.siteKey)) };
};
