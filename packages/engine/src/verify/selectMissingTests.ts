import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '../common/utils/isInertSourceFile';
import { isTestableSourceFile } from '../common/utils/isTestableSourceFile';
import { isTestFile } from '../common/utils/isTestFile';

interface Params {
	cwd: string;
	/** The verify basis — generated prefixes already filtered. */
	changedFiles: string[];
	/** The subset of changedFiles that are NEW (from readGitAddedFiles) — routes the red/advisory split (decision 23). */
	newFiles: string[];
	/** The consumer's TypeScript, or undefined — the check is skipped (with a note) without one. */
	compiler: typeof ts | undefined;
}

/**
 * The missing-tests check (decisions 5, 23): changed runtime source files with
 * no co-located test sibling. Buckets mirror selectTestTargets — deleted and
 * inert (barrel/type-only) files are skipped. A flagged file routes by decision
 * 23: NEW files (in `newFiles`) go to the red `missingTests`, MODIFIED files to
 * the advisory `untestedChanges`. Without a resolvable compiler the whole check
 * is skipped with a note (decision 18) — a false red is worse here than the
 * wasted spawn selectTestTargets would risk.
 */
export const selectMissingTests = async ({
	cwd,
	changedFiles,
	newFiles,
	compiler,
}: Params): Promise<{ missingTests: string[]; untestedChanges: string[]; notes: string[] }> => {
	if (compiler === undefined) {
		return { missingTests: [], untestedChanges: [], notes: ['missing-tests check skipped — no typescript resolvable from the target repo'] };
	}

	const missingTests: string[] = [];
	const untestedChanges: string[] = [];
	const newSet = new Set(newFiles);

	for (const file of changedFiles) {
		if (isTestFile(file) || !isTestableSourceFile(file)) {
			continue;
		}

		const content = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (content === undefined) {
			// Unreadable: a deleted file has no source to cover — drop it. A file
			// still on disk (transiently unreadable) is treated as runtime code.
			const exists = await stat(join(cwd, file)).then(
				() => true,
				() => false,
			);

			if (!exists) {
				continue;
			}
		} else if (isInertSourceFile({ path: file, content, compiler })) {
			continue;
		}

		const fileName = basename(file);
		const stem = fileName.replace(/\.(m|c)?[jt]sx?$/i, '');
		const entries = await readdir(join(cwd, dirname(file))).catch(() => []);
		const hasSibling = entries.some((entry) => entry !== fileName && entry.startsWith(`${stem}.`) && isTestFile(entry));

		if (hasSibling) {
			continue;
		}

		(newSet.has(file) ? missingTests : untestedChanges).push(file);
	}

	return { missingTests, untestedChanges, notes: [] };
};
