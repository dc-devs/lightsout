import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanFinding } from '@lightsout/contracts';
import { isTestFile } from './isTestFile';
import { listSourceFiles } from './listSourceFiles';
import { loadConfig } from './loadConfig';
import { resolveConsumerTypescript } from './resolveConsumerTypescript';
import { scanAstFindings } from './scanAstFindings';
import { scanClones } from './scanClones';
import { scanDeadExports } from './scanDeadExports';
import { scanFilenameDuplicates } from './scanFilenameDuplicates';
import { scanStructure } from './scanStructure';

interface Params {
	cwd: string;
	/** Repo-relative subpath to scan (default: the whole repo). */
	path?: string;
	onProgress?: (message: string) => void;
}

/**
 * The structural detector suite: detection is code — agents never get asked
 * to "go find problems". Read-only; findings are typed (the future
 * remediation pipeline's work-list) and persisted to .lightsout/scan.json
 * as evidence. Works with or without a lightsout.config.json (the config
 * contributes its `generated` exclusions when present); the AST tier
 * borrows the consumer's TypeScript and reports honestly when it can't.
 */
export const runScan = async ({ cwd, path, onProgress }: Params) => {
	const progress = onProgress ?? (() => undefined);
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const repoFiles = await listSourceFiles({ cwd, exclude: config?.generated });
	const all = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = all.filter((file) => !isTestFile(file));
	const notes: string[] = [];

	progress(`scanning ${source.length} source file(s) (${all.length - source.length} test file(s) excluded from duplication tiers)`);

	const findings: ScanFinding[] = [];

	findings.push(...scanFilenameDuplicates({ files: source }));
	progress(`tier 0 (names): done`);
	findings.push(...(await scanClones({ cwd, files: source })));
	progress(`tier 1 (clones): done`);

	const compiler = resolveConsumerTypescript({ cwd });

	if (compiler) {
		findings.push(...(await scanAstFindings({ cwd, files: source, compiler })));
		progress(`tier 2 (ast) + size: done (typescript ${compiler.version})`);
	} else {
		notes.push('tier 2 (ast) + function-size audit skipped — no typescript resolvable from the target repo');
	}

	findings.push(...(await scanStructure({ cwd, files: source })));
	progress(`structure: done`);
	findings.push(...(await scanDeadExports({ cwd, files: all, referenceFiles: repoFiles })));
	progress(`dead exports: done`);

	const dir = join(cwd, '.lightsout');

	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'scan.json'), `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`, 'utf8');

	return { findings, notes };
};
