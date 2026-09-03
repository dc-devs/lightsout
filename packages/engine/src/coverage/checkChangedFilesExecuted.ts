import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type ts from 'typescript';
import { z } from 'zod';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { isToolingConfigFile } from '#src/common/sourceFiles/isToolingConfigFile.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { buildMissingSummaryMessage } from '#src/coverage/common/utils/buildMissingSummaryMessage.ts';
import { coverageScopeOf } from '#src/coverage/common/utils/coverageScopeOf.ts';
import { resolveScopeContext } from '#src/coverage/common/utils/resolveScopeContext.ts';
import { selectCollectedFiles } from '#src/coverage/selectCollectedFiles/index.ts';
import { selectUnloadableFiles } from '#src/coverage/selectUnloadableFiles/index.ts';

/**
 * The executed-statement half of an Istanbul json-summary, parsed at the
 * boundary. Loose objects, so a report's other metrics pass through untouched.
 */
const ExecutionSummaryReport = z.record(z.string(), z.looseObject({ statements: z.looseObject({ covered: z.unknown(), total: z.unknown() }) }));

// One scope's summary as executed-statement entries keyed repo-relative
// (report keys are absolute paths), or undefined when unreadable.
const readExecutionSummary = async ({ cwd, summaryPath }: { cwd: string; summaryPath: string }) => {
	try {
		const parsed = ExecutionSummaryReport.parse(JSON.parse(await readFile(join(cwd, summaryPath), 'utf8')));

		return new Map(Object.entries(parsed).map(([key, entry]) => [relative(cwd, key), entry.statements]));
	} catch {
		return undefined;
	}
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo-relative changed files to hold to the executed bar (orphans already excluded by the caller). */
	changedFiles: string[];
	/** The consumer's TypeScript, or undefined — without one the check is skipped (it cannot exempt type-only files). */
	compiler: typeof ts | undefined;
}

/**
 * The per-file accountability check: every changed file must show at least one
 * executed statement in the coverage report the gate just produced. The bar is
 * "ran at all" — thresholds stay with the repo's own coverage command.
 *
 * Five kinds of file are exempt, each because no test could move its number:
 *
 * - deleted files, and provably inert ones (type-only, barrels) — there is no
 *   statement to execute.
 * - a tool's own configuration file — the tool reads it, no test imports it.
 * - a file whose module-scope `await` the scope's own Jest loads as CommonJS,
 *   where that `await` is a syntax error. Under a Jest configured for ES
 *   modules the same file loads normally and is held to the bar like any other.
 * - files outside every coverage scope — outside the measurement entirely.
 * - a file the repo's own coverage configuration does not collect — it can
 *   never appear in the report, so demanding a statement of it reports a fault
 *   no test could fix.
 */
export const checkChangedFilesExecuted = async ({ cwd, config, changedFiles, compiler }: Params): Promise<string | undefined> => {
	if (changedFiles.length === 0 || compiler === undefined) {
		return undefined;
	}

	const { packagesDir, monorepo, scopes } = await resolveScopeContext({ cwd, config });
	const executable: string[] = [];

	for (const file of changedFiles.filter(
		(changed) => isTestableSourceFile({ path: changed }) && !isTestFile({ path: changed }) && !isToolingConfigFile({ path: changed, packagesDir }),
	)) {
		const content = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (content !== undefined && !isInertSourceFile({ path: file, content, compiler })) {
			executable.push(file);
		}
	}

	const { loadable: candidates } = await selectUnloadableFiles({ cwd, config, files: executable, compiler });

	if (candidates.length === 0) {
		return undefined;
	}

	const { collected } = await selectCollectedFiles({ cwd, config, files: candidates });

	// A phase whose changed files are all uncollected must not fail on a missing
	// report either — nothing here would ever be read from one.
	if (collected.length === 0) {
		return undefined;
	}

	const summaries = new Map<string, Awaited<ReturnType<typeof readExecutionSummary>>>();
	const unexecuted: string[] = [];

	for (const file of collected) {
		const scope = coverageScopeOf({ file, scopes, packagesDir, monorepo });

		if (scope === undefined) {
			continue;
		}

		if (!summaries.has(scope.scope)) {
			summaries.set(scope.scope, await readExecutionSummary({ cwd, summaryPath: scope.summaryPath }));
		}

		const summary = summaries.get(scope.scope);

		if (summary === undefined) {
			return buildMissingSummaryMessage({ summaryPath: scope.summaryPath, scope: scope.scope });
		}

		const entry = summary.get(file);

		if (entry === undefined || (entry.covered === 0 && entry.total !== 0)) {
			unexecuted.push(file);
		}
	}

	if (unexecuted.length === 0) {
		return undefined;
	}

	return `changed-file-execution: ${unexecuted.length} changed file(s) never executed under the tests: ${unexecuted.join(', ')} — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.`;
};
