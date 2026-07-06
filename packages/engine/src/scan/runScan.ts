import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ScanFinding } from '@lightsout/contracts';
import { isTestFile } from '../common/utils/isTestFile';
import { listSourceFiles } from '../common/utils/listSourceFiles';
import { loadConfig } from '../common/utils/loadConfig';
import { resolveConsumerTypescript } from '../common/utils/resolveConsumerTypescript';
import { scanAstFindings } from './scanAstFindings';
import { scanClones } from './scanClones';
import { scanDeadExports } from './scanDeadExports';
import { scanFilenameDuplicates } from './scanFilenameDuplicates';
import { scanModuleBoundaries } from './scanModuleBoundaries';
import { scanStructure } from './scanStructure';

const ScanBaseline = z.object({
	at: z.string(),
	path: z.string(),
	clusters: z.array(z.string()),
});

/** Deepest directory (depth ≥ 2) holding >50% of findings — a report dominated by one path should diagnose its own config gap (live case: a generated Prisma dir missing from `generated`). */
const dominantPath = ({ findings }: { findings: ScanFinding[] }) => {
	const paths = findings.map((finding) => finding.files[0]?.path).filter((path): path is string => path !== undefined);

	if (paths.length < 20) {
		return undefined;
	}

	let prefix = '';
	let count = paths.length;

	for (;;) {
		const children = new Map<string, number>();

		for (const path of paths) {
			if (prefix && !path.startsWith(`${prefix}/`)) {
				continue;
			}

			const segment = path.slice(prefix ? prefix.length + 1 : 0).split('/')[0];

			if (segment && !segment.includes('.')) {
				children.set(segment, (children.get(segment) ?? 0) + 1);
			}
		}

		const next = [...children.entries()].sort((a, b) => b[1] - a[1])[0];

		if (!next || next[1] / paths.length <= 0.5) {
			break;
		}

		prefix = prefix ? `${prefix}/${next[0]}` : next[0];
		count = next[1];
	}

	return prefix.split('/').length >= 2 ? { dir: prefix, count, total: paths.length } : undefined;
};

interface Params {
	cwd: string;
	/** Repo-relative subpath to scan (default: the whole repo). */
	path?: string;
	/** Include baselined findings instead of only what's new since the baseline. */
	all?: boolean;
	/** Write/refresh lightsout.scan-baseline.json — the explicit act of accepting the current findings as existing debt. */
	writeBaseline?: boolean;
	/** Skip writing .lightsout/scan.json — for in-pipeline scans that must not clobber the user's standalone report. */
	persist?: boolean;
	onProgress?: (message: string) => void;
}

/**
 * The structural detector suite: detection is code — agents never get asked
 * to "go find problems". Read-only apart from .lightsout/scan.json (the
 * typed evidence file, the future remediation pipeline's work-list).
 * Baselining is explicit, never a side effect: `writeBaseline` writes
 * lightsout.scan-baseline.json at the repo root — a COMMITTED debt ledger,
 * like phpstan-baseline.neon or detekt's baseline.xml — and later scans
 * report only findings whose cluster is not in it (`all` overrides). Works
 * with or without a lightsout.config.json (the config contributes
 * `generated` exclusions and `scan` tuning when present); the AST tier
 * borrows the consumer's TypeScript and reports honestly when it can't.
 */
export const runScan = async ({ cwd, path, all = false, writeBaseline = false, persist = true, onProgress }: Params) => {
	const progress = onProgress ?? (() => undefined);
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const repoFiles = await listSourceFiles({ cwd, exclude: config?.generated });
	const allFiles = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = allFiles.filter((file) => !isTestFile(file));
	const notes: string[] = [];

	progress(`scanning ${source.length} source file(s) (${allFiles.length - source.length} test file(s) excluded from duplication tiers)`);

	const findings: ScanFinding[] = [];

	findings.push(...scanFilenameDuplicates({ files: source }));
	progress(`tier 0 (names): done`);
	findings.push(...(await scanClones({ cwd, files: source, minTokens: config?.scan?.minCloneTokens })));
	progress(`tier 1 (clones): done`);

	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config?.packagesDir });

	if (compiler) {
		findings.push(...(await scanAstFindings({ cwd, files: source, compiler, size: config?.scan?.size })));
		progress(`tier 2 (ast) + size: done (typescript ${compiler.version})`);
		findings.push(...(await scanModuleBoundaries({ cwd, files: allFiles, compiler })));
		progress(`module boundaries: done`);
	} else {
		notes.push('tier 2 (ast) + function-size audit + architecture detectors skipped — no typescript resolvable from the target repo');
	}

	findings.push(...(await scanStructure({ cwd, files: source })));
	progress(`structure: done`);
	findings.push(...(await scanDeadExports({ cwd, files: allFiles, referenceFiles: repoFiles })));
	progress(`dead exports: done`);

	const dominant = dominantPath({ findings });

	if (dominant) {
		notes.push(
			`${Math.round((dominant.count / dominant.total) * 100)}% of findings (${dominant.count}/${dominant.total}) sit under ${dominant.dir}/ — if that path is generated output, add it to the config's "generated" list`,
		);
	}

	const dir = join(cwd, '.lightsout');

	await mkdir(dir, { recursive: true });

	// The baseline lives at the repo root, next to the config, so it gets
	// COMMITTED — a debt ledger the PR that creates it makes reviewable, and
	// whose shrinking diff is the burn-down. Never under gitignored .lightsout/.
	const baselinePath = join(cwd, 'lightsout.scan-baseline.json');
	const baselineRaw = await readFile(baselinePath, 'utf8').catch(() => undefined);

	let baselineJson: unknown;

	try {
		baselineJson = baselineRaw === undefined ? undefined : JSON.parse(baselineRaw);
	} catch {
		baselineJson = null; // present but corrupt — safeParse below fails it into the unreadable branch
	}

	const baseline = baselineRaw === undefined ? undefined : ScanBaseline.safeParse(baselineJson);

	let reported = findings;

	if (writeBaseline) {
		const clusters = [...new Set(findings.map((finding) => finding.cluster))];

		await writeFile(baselinePath, `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', clusters }, undefined, '\t')}\n`, 'utf8');
		notes.push(
			`baseline ${baseline === undefined ? 'written' : 'refreshed'}: ${clusters.length} cluster(s) accepted as existing debt — commit lightsout.scan-baseline.json; future scans report only NEW findings (--all shows everything)`,
		);
	} else if (baseline === undefined) {
		if (findings.length > 0) {
			notes.push(`no baseline — \`lightsout scan --baseline\` accepts these findings as existing debt so future scans report only what's new`);
		}
	} else if (baseline.success) {
		const accepted = new Set(baseline.data.clusters);
		const fresh = findings.filter((finding) => !accepted.has(finding.cluster));
		const currentClusters = new Set(findings.map((finding) => finding.cluster));
		const resolved = baseline.data.clusters.filter((cluster) => !currentClusters.has(cluster)).length;

		reported = all ? findings : fresh;

		if (!all && findings.length > fresh.length) {
			notes.push(`${findings.length - fresh.length} baselined finding(s) suppressed (--all to include)`);
		}

		if (resolved > 0) {
			notes.push(`${resolved} baselined cluster(s) no longer found — burn-down progress (--baseline to refresh the ledger)`);
		}
	} else {
		notes.push('lightsout.scan-baseline.json is unreadable — ignored; re-run with --baseline to rewrite it');
	}

	if (persist) {
		await writeFile(join(dir, 'scan.json'), `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`, 'utf8');
	}

	return { findings: reported, notes };
};
