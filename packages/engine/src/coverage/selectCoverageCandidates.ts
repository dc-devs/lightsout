import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '@/common/utils/isInertSourceFile';
import { isTestableSourceFile } from '@/common/utils/isTestableSourceFile';
import { isTestFile } from '@/common/utils/isTestFile';
import type { CoverageFile, CoverageTotal } from '@/contracts';

interface Params {
	cwd: string;
	/** This round's measurement: every measured file, and each scope's own verdict. */
	measured: { files: CoverageFile[]; totals: CoverageTotal[] };
	/** Paths already routed to a human — never handed to another writer. */
	setAsidePaths: Set<string>;
	/** Repo-relative standards-package roots, resolved once by the pipeline — a rule check under a package's `tests/` document set is source, not a test. */
	standardsPackages: string[];
	/** The consumer's TypeScript module, or undefined — nothing is classified inert without one. */
	compiler: typeof ts | undefined;
}

/**
 * The files a round may batch, worst-first (the measurement's own order).
 *
 * Four exclusions, each for its own reason: a scope whose coverage command
 * already exits 0 is done, so work never goes there; a set-aside file is a
 * human's to answer; a fully covered file has nothing left to gain; and a test
 * file is the instrument, never the target — a misconfigured coverage
 * collection can put one in the summary.
 *
 * Untestable source is excluded too: a non-JS/TS file earns no writer, and a
 * barrel or type-only file provably holds no executable code. Those sit at the
 * bottom of a statements ordering, so leaving them in would fill the first
 * batches with guaranteed declines — enough in a row to read as a systemic
 * stop. Classification borrows the consumer's TypeScript; without one, nothing
 * is inert, the same honest degradation grouping makes.
 */
export const selectCoverageCandidates = async ({ cwd, measured, setAsidePaths, standardsPackages, compiler }: Params): Promise<CoverageFile[]> => {
	const failingScopes = new Set(measured.totals.filter((total) => !total.passed).map((total) => total.scope));
	const candidates: CoverageFile[] = [];

	for (const file of measured.files) {
		if (
			!failingScopes.has(file.scope) ||
			setAsidePaths.has(file.path) ||
			file.statementsPct >= 100 ||
			isTestFile({ path: file.path, standardsPackages }) ||
			!isTestableSourceFile(file.path)
		) {
			continue;
		}

		const content = compiler === undefined ? undefined : await readFile(join(cwd, file.path), 'utf8').catch(() => undefined);

		if (compiler !== undefined && content !== undefined && isInertSourceFile({ path: file.path, content, compiler })) {
			continue;
		}

		candidates.push(file);
	}

	return candidates;
};
