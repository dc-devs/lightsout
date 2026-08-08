import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { StandardsSeverity, type StandardsFinding } from '@/contracts';

const StandardsBaseline = z.object({
	at: z.string(),
	path: z.string(),
	siteKeys: z.array(z.string()),
});

interface Params {
	cwd: string;
	/** The run's scope, recorded in a freshly written ledger. */
	path?: string;
	/** Everything the checks found this run. */
	findings: StandardsFinding[];
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
 * effect of a check run. An unreadable ledger suppresses nothing — it is called
 * out and ignored, because silently hiding findings behind a corrupt file is
 * the one failure mode a debt ledger must not have.
 *
 * Split out of `runStandardsCheck` so that function reads as detection then
 * persistence: which findings a repo has already accepted is policy, not
 * detection. A module internal — its behaviour is pinned through
 * `runStandardsCheck`'s own baseline tests.
 */
export const applyStandardsBaseline = async ({ cwd, path, findings, all, writeBaseline }: Params): Promise<{ reported: StandardsFinding[]; notes: string[] }> => {
	const baselinePath = join(cwd, 'lightsout.standards-baseline.json');
	const baselineRaw = await readFile(baselinePath, 'utf8').catch(() => undefined);
	const notes: string[] = [];

	let baselineJson: unknown;

	try {
		baselineJson = baselineRaw === undefined ? undefined : JSON.parse(baselineRaw);
	} catch {
		baselineJson = null; // present but corrupt — safeParse below fails it into the unreadable branch
	}

	const baseline = baselineRaw === undefined ? undefined : StandardsBaseline.safeParse(baselineJson);

	if (writeBaseline) {
		const siteKeys = [...new Set(findings.map((finding) => finding.siteKey))];

		await writeFile(baselinePath, `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', siteKeys }, undefined, '\t')}\n`, 'utf8');
		notes.push(
			`baseline ${baseline === undefined ? 'written' : 'refreshed'}: ${siteKeys.length} site(s) accepted as existing debt — commit lightsout.standards-baseline.json; future runs report only NEW findings (--all shows everything)`,
		);

		return { reported: findings, notes };
	}

	if (baseline === undefined) {
		// Offered for findings only. An advisory is guidance to judge in place,
		// not debt to accept, and inviting a repo to ledger its advice would turn
		// the hint into a way to stop hearing it.
		if (findings.some((finding) => finding.severity === StandardsSeverity.Finding)) {
			notes.push(`no baseline — \`lightsout standards-check --baseline\` accepts these findings as existing debt so future runs report only what's new`);
		}

		return { reported: findings, notes };
	}

	if (!baseline.success) {
		notes.push('lightsout.standards-baseline.json is unreadable — ignored; re-run with --baseline to rewrite it');

		return { reported: findings, notes };
	}

	const accepted = new Set(baseline.data.siteKeys);
	const fresh = findings.filter((finding) => !accepted.has(finding.siteKey));
	const currentSiteKeys = new Set(findings.map((finding) => finding.siteKey));
	const resolved = baseline.data.siteKeys.filter((siteKey) => !currentSiteKeys.has(siteKey)).length;

	if (!all && findings.length > fresh.length) {
		notes.push(`${findings.length - fresh.length} baselined finding(s) suppressed (--all to include)`);
	}

	if (resolved > 0) {
		notes.push(`${resolved} baselined site(s) no longer found — burn-down progress (--baseline to refresh the ledger)`);
	}

	return { reported: all ? findings : fresh, notes };
};
