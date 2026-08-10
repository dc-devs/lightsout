import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import type { CoverageFile, CoverageTotal, LightsoutConfig } from '@/contracts';
import { defaultCoverageSummaryPath } from '@/common/constants/defaultCoverageSummaryPath';
import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { extractRunScriptName } from '@/common/utils/extractRunScriptName';
import { resolvePackageManifest } from '@/common/utils/resolvePackageManifest';
import { runCommand } from '@/common/utils/runCommand';
import { appendCommandLog } from '@/runState';

const rootScope = 'root';

/**
 * The Istanbul json-summary shape, parsed at the boundary: one entry per file
 * plus a `total`, each carrying a statements percentage. Loose objects, so a
 * report's other metrics (branches, functions, lines) pass through untouched
 * rather than failing a measurement that does not read them.
 */
const CoverageSummaryReport = z.record(z.string(), z.looseObject({ statements: z.looseObject({ pct: z.unknown() }) }));

/** One scope's coverage command, and where that scope writes its summary. */
interface ScopeCommand {
	scope: string;
	command: string;
	/** Repo-relative path to this scope's summary report. */
	summaryPath: string;
}

const readJsonFile = async ({ path }: { path: string }) => {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

		return parsed;
	} catch {
		return undefined;
	}
};

/**
 * Every package under packagesDir that defines the coverage template's run
 * script, narrowed to one package when the caller named a scope. The
 * script-missing skip mirrors `runPackageGates`: a scoped template fans out to
 * packages the consumer never hand-tuned, and one with nothing to measure is
 * legitimate.
 */
const listPackageScopes = async ({
	cwd,
	packagesDir,
	template,
	summaryPath,
	scope,
}: {
	cwd: string;
	packagesDir: string;
	template: string;
	summaryPath: string;
	scope?: string;
}) => {
	const entries = await readdir(join(cwd, packagesDir), { withFileTypes: true }).catch(() => []);
	const scriptName = extractRunScriptName({ command: template });
	const scopes: ScopeCommand[] = [];

	for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
		if (scope !== undefined && scope !== entry.name) {
			continue;
		}

		const manifest = await resolvePackageManifest({ cwd, packagesDir, packageDir: entry.name }).catch(() => undefined);

		if (!manifest || (scriptName !== undefined && !Object.hasOwn(manifest.scripts, scriptName))) {
			continue;
		}

		scopes.push({
			scope: entry.name,
			command: template.split('{package}').join(manifest.name),
			summaryPath: join(packagesDir, entry.name, summaryPath),
		});
	}

	return scopes;
};

/**
 * Which commands make up this measurement. Monorepo mode — a scoped coverage
 * template — measures packages ONLY: `scripts.*` is the root-group gate, and a
 * whole-repo root measure would count every package file a second time under a
 * scope no batch belongs to.
 */
const resolveScopes = async ({ cwd, config, summaryPath, scope }: { cwd: string; config: LightsoutConfig; summaryPath: string; scope?: string }) => {
	const template = config.packageScripts?.testCoverage;

	if (template) {
		return listPackageScopes({ cwd, packagesDir: config.packagesDir ?? defaultPackagesDir, template, summaryPath, scope });
	}

	const command = config.scripts.testCoverage;
	const scoped: ScopeCommand[] =
		typeof command === 'string' && (scope === undefined || scope === rootScope) ? [{ scope: rootScope, command, summaryPath }] : [];

	return scoped;
};

/** One scope's measured files and total, read from the summary its command just wrote. */
const readScopeSummary = async ({ cwd, scope, summaryPath, passed }: { cwd: string; scope: string; summaryPath: string; passed: boolean }) => {
	const parsed = CoverageSummaryReport.safeParse(await readJsonFile({ path: join(cwd, summaryPath) }));

	if (!parsed.success) {
		throw new Error(
			`no readable coverage summary at ${summaryPath} after the ${scope} coverage command ran — configure a json-summary coverage reporter (jest: coverageReporters ['json-summary']) writing that path, or set coverageSummaryPath in lightsout.config.json. \`lightsout doctor\` checks this.`,
		);
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
	const summaryPath = config.coverageSummaryPath ?? defaultCoverageSummaryPath;
	const scopes = await resolveScopes({ cwd, config, summaryPath, scope });
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
