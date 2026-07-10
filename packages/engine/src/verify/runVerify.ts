import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GateResult, VerifyReport } from '@lightsout/contracts';
import { ScanSeverity, VerifyBasis, VerifyVerdict } from '@lightsout/contracts';
import { readGitAddedFiles } from '../common/git/readGitAddedFiles';
import { readGitChangedFiles } from '../common/git/readGitChangedFiles';
import { readGitDiffFiles } from '../common/git/readGitDiffFiles';
import { loadConfig } from '../common/utils/loadConfig';
import { packageOf } from '../common/utils/packageOf';
import { resolveConsumerTypescript } from '../common/utils/resolveConsumerTypescript';
import { runGates } from '../pipeline';
import { runScan } from '../scan';
import { selectMissingTests } from './selectMissingTests';

interface Params {
	cwd: string;
	/** Diff basis ref — switches the basis from the dirty tree to git diff <ref> ∪ dirty tree. */
	base?: string;
	/** Coverage gate — on by default (--skip-coverage turns it off). */
	coverage?: boolean;
	onProgress?: (message: string) => void;
}

/**
 * Stateless one-shot verification of the current changed files: consumer gates
 * scoped to the affected packages, read-only scan findings touching the diff,
 * and a missing-tests check — one typed VerifyReport, overwritten to
 * `.lightsout/verify.json` every run. No run state, no fixing, no loops: the
 * caller loops (run verify after each change until clean). The verdict rides
 * the report; the CLI maps it to the exit code.
 *
 * @throws {Error} When no config resolves, cwd is not a git worktree, or `base` is not a resolvable ref (all exit 2 at the CLI).
 */
export const runVerify = async ({ cwd, base, coverage = true, onProgress }: Params): Promise<VerifyReport> => {
	const config = await loadConfig({ cwd });

	const persist = async (report: VerifyReport): Promise<VerifyReport> => {
		const dir = join(cwd, '.lightsout');

		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'verify.json'), `${JSON.stringify(report, undefined, '\t')}\n`, 'utf8');

		return report;
	};

	const dirty = await readGitChangedFiles({ cwd });

	if (dirty === undefined) {
		throw new Error('not inside a git worktree — verify needs git-truth changed files');
	}

	const basis = base !== undefined ? VerifyBasis.BaseRef : VerifyBasis.DirtyTree;
	const union = base !== undefined ? [...new Set([...dirty, ...(await readGitDiffFiles({ cwd, base }))])] : dirty;
	const isGeneratedFile = (file: string) => (config.generated ?? []).some((prefix) => file.startsWith(prefix));
	const changedFiles = union.filter((file) => !isGeneratedFile(file));

	const at = new Date().toISOString();
	const baseRefField = base !== undefined ? { baseRef: base } : {};

	if (changedFiles.length === 0) {
		return persist({
			at,
			basis,
			...baseRefField,
			changedFiles: [],
			packages: [],
			includeRoot: false,
			gates: [],
			findings: [],
			missingTests: [],
			untestedChanges: [],
			notes: [`nothing to verify — the ${basis} basis is empty (a fresh commit empties the dirty tree; --base <ref> verifies committed work)`],
			verdict: VerifyVerdict.Clean,
		});
	}

	const packagesDir = config.packagesDir ?? 'packages';
	const packages = [...new Set(changedFiles.flatMap((file) => packageOf({ file, packagesDir }) ?? []))];
	const includeRoot = changedFiles.some((file) => packageOf({ file, packagesDir }) === undefined);

	const gates: GateResult[] = [];
	const gatesError = await runGates({
		cwd,
		config,
		coverage,
		packages,
		includeRoot,
		failFast: false,
		onGateResult: (result) => gates.push(result),
		onProgress,
	});

	const scan = await runScan({ cwd, persist: false, onProgress });
	const changedSet = new Set(changedFiles);
	const findings = scan.findings.filter((finding) => finding.files.some((file) => changedSet.has(file.path)));

	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config.packagesDir });
	const newFiles = await readGitAddedFiles({ cwd, base });
	const { missingTests, untestedChanges, notes: testNotes } = await selectMissingTests({ cwd, changedFiles, newFiles, compiler });

	const verdict =
		gatesError !== undefined || findings.some((finding) => finding.severity === ScanSeverity.Finding) || missingTests.length > 0
			? VerifyVerdict.Red
			: VerifyVerdict.Clean;

	return persist({
		at,
		basis,
		...baseRefField,
		changedFiles,
		packages,
		includeRoot,
		gates,
		...(gatesError !== undefined ? { gatesError } : {}),
		findings,
		missingTests,
		untestedChanges,
		notes: [...scan.notes, ...testNotes],
		verdict,
	});
};
