import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * An Istanbul json-summary report as the tooling writes it: absolute file
 * keys, a `total` entry, and other metrics riding along untouched.
 */
const writeSummary = ({ dir, at, total, files }: { dir: string; at: string; total: number; files: Record<string, number | string> }) => {
	const path = join(dir, at);

	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify({
			total: { statements: { pct: total, covered: 1, total: 2 }, branches: { pct: 40 } },
			...Object.fromEntries(Object.entries(files).map(([file, pct]) => [join(dir, file), { statements: { pct }, lines: { pct: 1 } }])),
		}),
	);
};

/** A single-package consumer whose coverage command exits as told, over a summary already on disk. */
const setupRootRepo = ({
	exitCode = 0,
	files = { 'src/a.ts': 10 },
	summaryAt = 'coverage/coverage-summary.json',
	summary = true,
}: {
	exitCode?: number;
	files?: Record<string, number | string>;
	summaryAt?: string;
	summary?: boolean;
} = {}) => {
	const dir = setupConsumerRepo({ git: false, scripts: { 'test-coverage': exitCode === 0 ? 'true' : 'false' } });

	if (summary) {
		writeSummary({ dir, at: summaryAt, total: 61.5, files });
	}

	return dir;
};

/** A monorepo whose per-package coverage template logs "<package name> coverage" and whose summaries are already on disk. */
const setupScopedRepo = ({
	webPasses = true,
	apiScripts = { 'test:coverage': 'x' },
	runScript = ' run test:coverage',
}: {
	webPasses?: boolean;
	apiScripts?: Record<string, string>;
	runScript?: string;
} = {}) => {
	// The template logs rather than measures, so a package "fails" by the guard
	// appended to its command — the exit code is the only signal the engine reads.
	const guard = webPasses ? '' : ' && [ "{package}" != "@acme/web" ]';
	const dir = setupConsumerRepo({
		git: false,
		config: {
			'package-gates': {
				check: 'true {package}',
				test: 'true {package}',
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} {package}${runScript}${guard}`,
			},
		},
	});

	for (const [packageDir, scripts] of [
		['api', apiScripts],
		['web', { 'test:coverage': 'x' }],
	] as const) {
		mkdirSync(join(dir, 'packages', packageDir), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}`, scripts }));
	}

	writeSummary({ dir, at: 'packages/api/coverage/coverage-summary.json', total: 40, files: { 'packages/api/src/a.ts': 12 } });
	writeSummary({ dir, at: 'packages/web/coverage/coverage-summary.json', total: 99, files: { 'packages/web/src/b.ts': 95 } });

	return dir;
};

describe('runCoverageCheck', () => {
	test('a green root command reports passed, with every measured file relative to the repo', async () => {
		const dir = setupRootRepo({ files: { 'src/a.ts': 10, 'src/b.ts': 90 } });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		expect(measured.passed).toBe(true);
		// report keys are absolute; everything downstream speaks repo-relative
		expect(measured.files.map((file) => file.path)).toStrictEqual(['src/a.ts', 'src/b.ts']);
		expect(measured.totals).toStrictEqual([{ scope: 'root', statementsPct: 61.5, passed: true }]);
	});

	test('a red root command is the whole done signal — the engine never reads a threshold', async () => {
		const dir = setupRootRepo({ exitCode: 1 });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		// the file sits at 10% and the run is not done — but nothing here knows why
		expect(measured.passed).toBe(false);
		expect(measured.totals[0]?.passed).toBe(false);
	});

	test('files come back worst-first, ties broken by path so two rounds pick the same work', async () => {
		const dir = setupRootRepo({ files: { 'src/z.ts': 30, 'src/a.ts': 30, 'src/low.ts': 4 } });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		expect(measured.files.map((file) => file.path)).toStrictEqual(['src/low.ts', 'src/a.ts', 'src/z.ts']);
	});

	test("a file Istanbul reports as 'Unknown' is skipped rather than ordered as if it were zero", async () => {
		const dir = setupRootRepo({ files: { 'src/empty.ts': 'Unknown', 'src/a.ts': 10 } });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		// an empty file has no percentage — it would otherwise head every work-list
		expect(measured.files.map((file) => file.path)).toStrictEqual(['src/a.ts']);
	});

	test('a summary the coverage run never wrote is a hard error naming the path and the fix', async () => {
		const dir = setupRootRepo({ summary: false });

		const error = await getRejectionError({ promise: runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) }) });

		expect(error.message).toContain('coverage/coverage-summary.json');
		expect(error.message).toMatch(/json-summary/);
		expect(error.message).toMatch(/coverage-summary-path/);
	});

	test('a summary whose shape the engine cannot read fails the same way a missing one does', async () => {
		const dir = setupRootRepo({ summary: false });

		mkdirSync(join(dir, 'coverage'), { recursive: true });
		// a report written by a reporter that measures something else entirely
		writeFileSync(join(dir, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 100 } } }));

		const error = await getRejectionError({ promise: runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) }) });

		expect(error.message).toMatch(/no readable coverage summary/);
	});

	test('a configured summary path is read instead of the Istanbul default', async () => {
		const dir = setupRootRepo({ summaryAt: 'reports/summary.json' });

		writeFileSync(
			join(dir, 'lightsout.config.json'),
			JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': 'true' }, 'coverage-summary-path': 'reports/summary.json' }),
		);

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		expect(measured.files.map((file) => file.path)).toStrictEqual(['src/a.ts']);
	});

	test('naming the root scope re-measures the root command, the way a post-batch re-measure asks for it', async () => {
		const dir = setupRootRepo();

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }), scope: 'root' });

		expect(measured.totals).toStrictEqual([{ scope: 'root', statementsPct: 61.5, passed: true }]);
	});

	test('naming a package scope in a single-package repo measures nothing — there is no such scope', async () => {
		const dir = setupRootRepo();

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }), scope: 'api' });

		// the root command is not a stand-in for a package that was never configured
		expect(measured).toStrictEqual({ passed: false, files: [], totals: [] });
	});

	test('monorepo mode measures packages only, merging both summaries into one worst-first list', async () => {
		const dir = setupScopedRepo();

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		expect(measured.files.map((file) => [file.path, file.scope])).toStrictEqual([
			['packages/api/src/a.ts', 'api'],
			['packages/web/src/b.ts', 'web'],
		]);
		// the package.json name, not the directory, is what a workspace filter wants
		expect(readGateLog({ dir })).toStrictEqual(['@acme/api coverage', '@acme/web coverage']);
		// the root command never participates: it would count every package file twice
		expect(measured.totals.map((total) => total.scope)).toStrictEqual(['api', 'web']);
	});

	test('one red package flips only its own scope, so a green package never earns a batch', async () => {
		const dir = setupScopedRepo({ webPasses: false });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		expect(measured.passed).toBe(false);
		expect(measured.totals.map((total) => [total.scope, total.passed])).toStrictEqual([
			['api', true],
			['web', false],
		]);
	});

	test('a package with no coverage script is skipped, exactly as its scoped gate would be', async () => {
		const dir = setupScopedRepo({ apiScripts: {} });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		// a package the consumer never hand-tuned has nothing to measure
		expect(measured.totals.map((total) => total.scope)).toStrictEqual(['web']);
		expect(readGateLog({ dir })).toStrictEqual(['@acme/web coverage']);
	});

	test('a template naming no script measures every package, since there is nothing to look up', async () => {
		const dir = setupScopedRepo({ apiScripts: {}, runScript: '' });

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		// the same convention the scoped gates keep: nothing to detect, nothing to skip
		expect(measured.totals.map((total) => total.scope)).toStrictEqual(['api', 'web']);
	});

	test('each scope reports its own exit as it lands, so a long fleet is never silent', async () => {
		const dir = setupScopedRepo({ webPasses: false });
		const messages: string[] = [];

		await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }), onProgress: (message) => messages.push(message) });

		// the trailing duration is timing, not contract
		expect(messages.map((message) => message.split(' (')[0])).toStrictEqual(['coverage [api]: exit 0', 'coverage [web]: exit 1']);
	});

	test('a named scope re-measures that package alone — the rest of the fleet is not re-run', async () => {
		const dir = setupScopedRepo();

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }), scope: 'api' });

		expect(measured.totals.map((total) => total.scope)).toStrictEqual(['api']);
		expect(readGateLog({ dir })).toStrictEqual(['@acme/api coverage']);
	});

	test('with a run id every measurement leaves a command-log record under the step that asked for it', async () => {
		const dir = setupRootRepo();

		await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }), runId: 'run-measure', step: 'measure' });

		const record = JSON.parse(readFileSync(join(dir, '.lightsout', 'runs', 'run-measure', 'commands.jsonl'), 'utf8').trim()) as Record<string, unknown>;

		expect(record.kind).toBe('testCoverage');
		expect(record.group).toBe('root');
		expect(record.step).toBe('measure');
		expect(record.exitCode).toBe(0);
	});

	test('a repo that opted out of the coverage gate measures nothing and reports not passed', async () => {
		const dir = setupRootRepo();

		writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));

		const measured = await runCoverageCheck({ cwd: dir, config: await loadConfig({ cwd: dir }) });

		// nothing ran, so nothing is green — the command refuses this config up front
		expect(measured).toStrictEqual({ passed: false, files: [], totals: [] });
	});
});
