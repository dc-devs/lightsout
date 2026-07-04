import { ScanSeverity, type ScanFinding } from '@lightsout/contracts';

/** Cluster prefixes with stable path-keyed identities — safe to gate on. Line-keyed detectors (clone, size) inform the work-list but never block: a shifted line makes an old finding look new. */
const gatingClusterPattern = /^(ast:|multi-export:)/;

interface Params {
	findings: ScanFinding[];
	/** Repo-relative files this run changed. */
	changedFiles: string[];
}

/**
 * The refactor step's deterministic work-list: finding-severity items that
 * touch at least one file the run changed. Pre-existing debt in untouched
 * files never appears, and the committed baseline (when present) has
 * already suppressed accepted debt inside the changed files. `gating` is
 * the subset the scan gate may block on.
 */
export const selectScanFindings = ({ findings, changedFiles }: Params) => {
	const changed = new Set(changedFiles);
	const workList = findings.filter(
		(finding) => finding.severity === ScanSeverity.Finding && finding.files.some((file) => changed.has(file.path)),
	);

	return { workList, gating: workList.filter((finding) => gatingClusterPattern.test(finding.cluster)) };
};
