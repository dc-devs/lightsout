import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StandardsFinding } from '@/contracts';
import { isTestFile } from '@/common/utils/isTestFile';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { loadConfig } from '@/common/utils/loadConfig';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { checkAstFindings } from '@/standardsCheck/checkAstFindings';
import { checkClones } from '@/standardsCheck/checkClones';
import { checkDeadExports } from '@/standardsCheck/checkDeadExports';
import { checkBarrelHygiene } from '@/standardsCheck/checkBarrelHygiene';
import { checkFilenameDuplicates } from '@/standardsCheck/checkFilenameDuplicates';
import { checkModuleBoundaries } from '@/standardsCheck/checkModuleBoundaries';
import { checkPlacement } from '@/standardsCheck/checkPlacement';
import { checkStructure } from '@/standardsCheck/checkStructure';
import { applyStandardsBaseline } from '@/standardsCheck/common/utils/applyStandardsBaseline';

/** Deepest directory (depth ≥ 2) holding >50% of findings — a report dominated by one path should diagnose its own config gap (live case: a generated Prisma dir missing from `generated`). */
const dominantPath = ({ findings }: { findings: StandardsFinding[] }) => {
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
	/** Repo-relative subpath to check (default: the whole repo). */
	path?: string;
	/** Include baselined findings instead of only what's new since the baseline. */
	all?: boolean;
	/** Write/refresh lightsout.standards-baseline.json — the explicit act of accepting the current findings as existing debt. */
	writeBaseline?: boolean;
	/** Skip writing .lightsout/standards-check.json — for in-pipeline runs that must not clobber the user's standalone report. */
	persist?: boolean;
	onProgress?: (message: string) => void;
}

/**
 * The structural standards-check suite: detection is code — agents never get
 * asked to "go find problems". Read-only apart from
 * .lightsout/standards-check.json (the typed evidence file, the future
 * remediation pipeline's work-list). Baselining is explicit, never a side
 * effect: `writeBaseline` writes lightsout.standards-baseline.json at the repo
 * root — a COMMITTED debt ledger, like phpstan-baseline.neon or detekt's
 * baseline.xml — and later runs report only findings whose site key is not in
 * it (`all` overrides). Works with or without a lightsout.config.json (the
 * config contributes `generated` exclusions and `standardsChecks` tuning when
 * present); the AST tier borrows the consumer's TypeScript and reports honestly
 * when it can't.
 */
export const runStandardsCheck = async ({
	cwd,
	path,
	all = false,
	writeBaseline = false,
	persist = true,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const progress = onProgress ?? (() => undefined);
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const repoFiles = await listSourceFiles({ cwd, exclude: config?.generated });
	const allFiles = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = allFiles.filter((file) => !isTestFile(file));
	const notes: string[] = [];

	progress(`checking ${source.length} source file(s) (${allFiles.length - source.length} test file(s) excluded from duplication tiers)`);

	const findings: StandardsFinding[] = [];

	findings.push(...checkFilenameDuplicates({ files: source }));
	progress(`tier 0 (names): done`);
	findings.push(...(await checkClones({ cwd, files: source, minTokens: config?.standardsChecks?.minCloneTokens })));
	progress(`tier 1 (clones): done`);

	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config?.packagesDir });

	if (compiler) {
		findings.push(...(await checkAstFindings({ cwd, files: source, compiler, size: config?.standardsChecks?.size })));
		progress(`tier 2 (ast) + size: done (typescript ${compiler.version})`);
		findings.push(...(await checkModuleBoundaries({ cwd, files: allFiles, compiler })));
		progress(`module boundaries: done`);
		findings.push(...(await checkPlacement({ cwd, files: allFiles, compiler })));
		progress(`placement: done`);
	} else {
		notes.push('ast tier + function-size audit + module-boundary/placement checks skipped — no typescript resolvable from the target repo');
	}

	// Barrel hygiene is text-based (barrel parsing + whole-word reference
	// counting, like dead exports) — no import resolution, so JS-only repos
	// keep it even when the compiler-gated checks degrade.
	findings.push(...(await checkBarrelHygiene({ cwd, files: allFiles, referenceFiles: repoFiles })));
	progress(`barrel hygiene: done`);

	findings.push(...(await checkStructure({ cwd, files: source })));
	progress(`structure: done`);
	findings.push(...(await checkDeadExports({ cwd, files: allFiles, referenceFiles: repoFiles })));
	progress(`dead exports: done`);

	const dominant = dominantPath({ findings });

	if (dominant) {
		notes.push(
			`${Math.round((dominant.count / dominant.total) * 100)}% of findings (${dominant.count}/${dominant.total}) sit under ${dominant.dir}/ — if that path is generated output, add it to the config's "generated" list`,
		);
	}

	const dir = join(cwd, '.lightsout');

	await mkdir(dir, { recursive: true });

	const baseline = await applyStandardsBaseline({ cwd, path, findings, all, writeBaseline });

	notes.push(...baseline.notes);

	if (persist) {
		await writeFile(join(dir, 'standards-check.json'), `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`, 'utf8');
	}

	return { findings: baseline.reported, notes };
};
