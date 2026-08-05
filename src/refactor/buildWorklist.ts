import { ScanDetector, ScanSeverity, type LightsoutConfig, type RefactorWorklist } from '@/contracts';
import { runScan } from '@/scan';
import { batchFindings } from '@/refactor/batchFindings';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo-relative scan scope (default: the whole repo). */
	path?: string;
	/** Include baselined findings — burn-down mode. */
	all?: boolean;
}

/**
 * Compute a run's work-list from the tree, once: scan (baseline-filtered
 * unless `all`), keep Finding severity as work, carry size advisories as
 * per-batch context, and batch deterministically. The caller freezes the
 * result into the run dir — the staleness lesson inverted: computed from the
 * tree, never hand-written; frozen for the run, never recomputed mid-run.
 */
export const buildWorklist = async ({ cwd, config, path, all = false }: Params): Promise<RefactorWorklist> => {
	const { findings } = await runScan({ cwd, path, all, persist: false });

	return {
		at: new Date().toISOString(),
		path: path ?? '.',
		all,
		batches: batchFindings({
			findings: findings.filter((finding) => finding.severity === ScanSeverity.Finding),
			// Size advisories only — the executor prompt frames advisories as the
			// size caps' judgment items; other advisory detectors (dead-export)
			// must not ride in as if they were work (in-pipeline precedent:
			// selectScanFindings).
			advisories: findings.filter((finding) => finding.severity === ScanSeverity.Advisory && finding.detector === ScanDetector.Size),
			packagesDir: config.packagesDir ?? 'packages',
		}),
	};
};
