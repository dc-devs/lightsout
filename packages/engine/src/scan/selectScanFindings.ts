import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';

/** Cluster prefixes with stable path-keyed identities — safe to gate on (size:file: and boundary: key on the path alone; per-function size and clone keys embed lines/names, so they inform the work-list but never block). Placement and barrel-star stay work-list, not gate, until they've been lived with. */
const gatingClusterPattern = /^(ast:|multi-export:|size:file:|boundary:)/;

interface Params {
	findings: ScanFinding[];
	/** Repo-relative files this run changed. */
	changedFiles: string[];
}

/**
 * The refactor step's deterministic work-list, filtered to findings that
 * touch at least one file the run changed. Pre-existing debt in untouched
 * files never appears, and the committed baseline (when present) has
 * already suppressed accepted debt inside the changed files. `workList` is
 * must-address; `advisories` are the size detector's judgment-carrying
 * items (function/hook/component caps with the orchestration exemption) —
 * sent to the agent to judge, never blocking; `gating` is the workList
 * subset the scan gate may block on.
 */
export const selectScanFindings = ({ findings, changedFiles }: Params) => {
	const changed = new Set(changedFiles);
	const touchesChanged = (finding: ScanFinding) => finding.files.some((file) => changed.has(file.path));
	const workList = findings.filter((finding) => finding.severity === ScanSeverity.Finding && touchesChanged(finding));
	const advisories = findings.filter(
		(finding) => finding.severity === ScanSeverity.Advisory && finding.detector === ScanDetector.Size && touchesChanged(finding),
	);

	return { workList, advisories, gating: workList.filter((finding) => gatingClusterPattern.test(finding.cluster)) };
};
