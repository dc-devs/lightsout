import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CoverageFile, CoverageTotal, LightsoutConfig } from '#src/contracts/index.ts';
import { buildMissingSummaryMessage } from '#src/coverage/common/utils/buildMissingSummaryMessage.ts';
import { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';
import { appendCommandLog } from '#src/runState/index.ts';

/**
 * The Istanbul json-summary shape, parsed at the boundary: one entry per file
 * plus a `total`, each carrying a statements percentage. Loose objects, so a
 * report's other metrics (branches, functions, lines) pass through untouched
 * rather than failing a measurement that does not read them.
 */
const CoverageSummaryReport = z.record(z.string(), z.looseObject({ statements: z.looseObject({ pct: z.unknown() }) }));

const readJsonFile = async ({ path }: { path: string }) => {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

		return parsed;
	} catch {
		return undefined;
	}
};

/** One scope's measured files and total, read from the summary its command just wrote. */
const readScopeSummary = async ({ cwd, scope, summaryPath, passed }: { cwd: string; scope: string; summaryPath: string; passed: boolean }) => {
	const parsed = CoverageSummaryReport.safeParse(await readJsonFile({ path: join(cwd, summaryPath) }));

	if (!parsed.success) {
		throw new Error(buildMissingSummaryMessage({ summaryPath, scope }));
	}

	const files: CoverageFile[] = [];
	let statementsPct = 0;

	for (const [key, entry] of Object.entries(parsed.data)) {
		const pct = entry.statements.pct;

		// Istanbul writes 'Unknown' for a file with no statements at all — there
		// is no percentage to order such a file by.
		if (typeof pct !== 'number') {
			continue;
		}

		if (key === 'total') {
			statementsPct = pct;
			continue;
		}

		// Report keys are absolute paths; everything downstream (git truth, agent
		// reports, the writer's file list) speaks repo-relative.
		files.push({ path: relative(cwd, key), scope, statementsPct: pct });
	}

	return { files, total: { scope, statementsPct, passed } };
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Restrict to one package dir (post-batch re-measure). Undefined = every configured scope. */
	scope?: string;
	/** When set, each command execution is appended to the run's commands.jsonl. */
	runId?: string;
	/** Pipeline step in flight, recorded in the command log. */
	step?: string;
	onProgress?: (message: string) => void;
}

/**
 * Measure coverage: run the consumer's own coverage command in every scope,
 * read each scope's JSON summary, and merge into one worst-first file list
 * with package attribution.
 *
 * The exit codes are the only done signal — the engine never learns the
 * threshold number, so the repo's test config stays the single source of truth
 * for what "covered enough" means. `passed` is the merged signal; each total
 * carries its own scope's verdict, which is what keeps a batch out of a
 * package whose gate is already green.
 *
 * @throws {Error} When a scope's summary is missing or unreadable after its command ran.
 */
export const runCoverageCheck = async ({
	cwd,
	config,
	scope,
	runId,
	step,
	onProgress,
}: Params): Promise<{ passed: boolean; files: CoverageFile[]; totals: CoverageTotal[] }> => {
	const summaryPath = config['coverage-summary-path'] ?? defaultCoverageSummaryPath;
	const scopes = await resolveCoverageScopes({ cwd, config, summaryPath, scope });
	const files: CoverageFile[] = [];
	const totals: CoverageTotal[] = [];

	for (const entry of scopes) {
		const startedAt = Date.now();
		const result = await runCommand({ command: entry.command, cwd });
		const durationMs = Date.now() - startedAt;

		onProgress?.(`coverage [${entry.scope}]: exit ${result.exitCode} (${(durationMs / 1000).toFixed(1)}s)`);

		if (runId) {
			await appendCommandLog({
				cwd,
				runId,
				record: { at: new Date().toISOString(), step, group: entry.scope, kind: 'testCoverage', command: entry.command, exitCode: result.exitCode, durationMs },
			});
		}

		const measured = await readScopeSummary({ cwd, scope: entry.scope, summaryPath: entry.summaryPath, passed: result.exitCode === 0 });

		files.push(...measured.files);
		totals.push(measured.total);
	}

	return {
		passed: totals.length > 0 && totals.every((total) => total.passed),
		files: files.sort((left, right) => left.statementsPct - right.statementsPct || left.path.localeCompare(right.path)),
		totals,
	};
};
