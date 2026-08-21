import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type ts from 'typescript';
import { z } from 'zod';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { isToolingConfigFile } from '#src/common/sourceFiles/isToolingConfigFile.ts';
import { isUnloadableSourceFile } from '#src/common/sourceFiles/isUnloadableSourceFile.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { CoverageScope } from '#src/coverage/common/types/CoverageScope.ts';
import { buildMissingSummaryMessage } from '#src/coverage/common/utils/buildMissingSummaryMessage.ts';
import { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';

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
 * The per-file accountability check: every changed file must show at least
 * one executed statement in the coverage report the gate just produced. The
 * bar is "ran at all" — thresholds stay with the repo's own coverage command.
 * Deleted files and provably inert ones (type-only, barrels) have nothing to
 * execute; a tool's own configuration and files the runner cannot load at all
 * (module-scope `await`) can never show an executed statement whatever the
 * tests do; files outside every coverage scope are outside the measurement.
 */
export const checkChangedFilesExecuted = async ({ cwd, config, changedFiles, compiler }: Params): Promise<string | undefined> => {
	if (changedFiles.length === 0 || compiler === undefined) {
		return undefined;
	}

	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const candidates: string[] = [];

	for (const file of changedFiles.filter(
		(changed) => isTestableSourceFile({ path: changed }) && !isTestFile({ path: changed }) && !isToolingConfigFile({ path: changed, packagesDir }),
	)) {
		const content = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (content !== undefined && !isInertSourceFile({ path: file, content, compiler }) && !isUnloadableSourceFile({ path: file, content, compiler })) {
			candidates.push(file);
		}
	}

	if (candidates.length === 0) {
		return undefined;
	}

	const summaryPath = config['coverage-summary-path'] ?? defaultCoverageSummaryPath;
	const scopes = await resolveCoverageScopes({ cwd, config, summaryPath });
	const monorepo = config['package-gates']?.['test-coverage'] !== undefined;

	// Monorepo mode measures packages only, so root files sit outside the
	// measurement; root mode's single scope owns files outside the packages dir.
	const scopeOf = ({ file }: { file: string }): CoverageScope | undefined => {
		const packageDir = packageOf({ file, packagesDir });

		if (monorepo) {
			return packageDir === undefined ? undefined : scopes.find((entry) => entry.scope === packageDir);
		}

		return packageDir === undefined ? scopes[0] : undefined;
	};

	const summaries = new Map<string, Awaited<ReturnType<typeof readExecutionSummary>>>();
	const unexecuted: string[] = [];

	for (const file of candidates) {
		const scope = scopeOf({ file });

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
