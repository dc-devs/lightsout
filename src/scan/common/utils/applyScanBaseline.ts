import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ScanSeverity, type ScanFinding } from '@/contracts';

const ScanBaseline = z.object({
	at: z.string(),
	path: z.string(),
	clusters: z.array(z.string()),
});

interface Params {
	cwd: string;
	/** The scan's scope, recorded in a freshly written ledger. */
	path?: string;
	/** Everything the detectors found this run. */
	findings: ScanFinding[];
	/** Report baselined findings too, instead of only what is new. */
	all: boolean;
	/** Accept the current findings as existing debt, writing or refreshing the ledger. */
	writeBaseline: boolean;
}

/**
 * The debt ledger, applied to one run's findings.
 *
 * The ledger lives at the repo root, next to the config, so it gets COMMITTED —
 * a debt record the PR that creates it makes reviewable, and whose shrinking
 * diff is the burn-down. Never under gitignored .lightsout/. A missing file is
 * the no-baseline state; there is no second location.
 *
 * Accepting debt is always an explicit act (`writeBaseline`), never a side
 * effect of scanning. An unreadable ledger suppresses nothing — it is called
 * out and ignored, because silently hiding findings behind a corrupt file is
 * the one failure mode a debt ledger must not have.
 *
 * Split out of `runScan` so that function reads as detection then persistence:
 * which findings a repo has already accepted is policy, not detection. A module
 * internal — its behaviour is pinned through `runScan`'s own baseline tests.
 */
export const applyScanBaseline = async ({ cwd, path, findings, all, writeBaseline }: Params): Promise<{ reported: ScanFinding[]; notes: string[] }> => {
	const baselinePath = join(cwd, 'lightsout.scan-baseline.json');
	const baselineRaw = await readFile(baselinePath, 'utf8').catch(() => undefined);
	const notes: string[] = [];

	let baselineJson: unknown;

	try {
		baselineJson = baselineRaw === undefined ? undefined : JSON.parse(baselineRaw);
	} catch {
		baselineJson = null; // present but corrupt — safeParse below fails it into the unreadable branch
	}

	const baseline = baselineRaw === undefined ? undefined : ScanBaseline.safeParse(baselineJson);

	if (writeBaseline) {
		const clusters = [...new Set(findings.map((finding) => finding.cluster))];

		await writeFile(baselinePath, `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', clusters }, undefined, '\t')}\n`, 'utf8');
		notes.push(
			`baseline ${baseline === undefined ? 'written' : 'refreshed'}: ${clusters.length} cluster(s) accepted as existing debt — commit lightsout.scan-baseline.json; future scans report only NEW findings (--all shows everything)`,
		);

		return { reported: findings, notes };
	}

	if (baseline === undefined) {
		// Offered for findings only. An advisory is guidance to judge in place,
		// not debt to accept, and inviting a repo to ledger its advice would turn
		// the hint into a way to stop hearing it.
		if (findings.some((finding) => finding.severity === ScanSeverity.Finding)) {
			notes.push(`no baseline — \`lightsout scan --baseline\` accepts these findings as existing debt so future scans report only what's new`);
		}

		return { reported: findings, notes };
	}

	if (!baseline.success) {
		notes.push('lightsout.scan-baseline.json is unreadable — ignored; re-run with --baseline to rewrite it');

		return { reported: findings, notes };
	}

	const accepted = new Set(baseline.data.clusters);
	const fresh = findings.filter((finding) => !accepted.has(finding.cluster));
	const currentClusters = new Set(findings.map((finding) => finding.cluster));
	const resolved = baseline.data.clusters.filter((cluster) => !currentClusters.has(cluster)).length;

	if (!all && findings.length > fresh.length) {
		notes.push(`${findings.length - fresh.length} baselined finding(s) suppressed (--all to include)`);
	}

	if (resolved > 0) {
		notes.push(`${resolved} baselined cluster(s) no longer found — burn-down progress (--baseline to refresh the ledger)`);
	}

	return { reported: all ? findings : fresh, notes };
};
