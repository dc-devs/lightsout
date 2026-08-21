import { type LightsoutConfig, type RefactorWorklist, StandardsSeverity } from '#src/contracts/index.ts';
import { batchFindings } from '#src/refactor/batch/index.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo-relative check scope (default: the whole repo). */
	path?: string;
	/** Include baselined findings — burn-down mode. */
	all?: boolean;
}

/**
 * Compute a run's work-list from the tree, once: check (baseline-filtered
 * unless `all`), keep Finding severity as work, carry every advisory as
 * per-batch context, and batch deterministically. The caller freezes the
 * result into the run dir — the staleness lesson inverted: computed from the
 * tree, never hand-written; frozen for the run, never recomputed mid-run.
 */
export const buildWorklist = async ({ cwd, config, path, all = false }: Params): Promise<RefactorWorklist> => {
	const { findings } = await runStandardsCheck({ cwd, path, all, persist: false });

	return {
		at: new Date().toISOString(),
		path: path ?? '.',
		all,
		batches: batchFindings({
			blocking: findings.filter((finding) => finding.severity === StandardsSeverity.Blocking),
			// Every advisory, not just the size ones: an advisory IS a judgment
			// call, and each carries its own guidance line for the agent to apply.
			// A rule whose advisories never reach the agent can never be judged —
			// it only ever reports to a human (in-pipeline precedent:
			// selectStandardsFindings).
			advisories: findings.filter((finding) => finding.severity === StandardsSeverity.Advisory),
			packagesDir: config['packages-dir'] ?? 'packages',
		}),
	};
};
