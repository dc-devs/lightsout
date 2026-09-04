import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { printResult } from '#src/cli/common/render/printResult.ts';
import type { FrictionRecord, RunManifest } from '#src/contracts/index.ts';
import { FrictionArea, PackagesSource, RunStatus } from '#src/contracts/index.ts';

// printResult summarizes a run from the evidence the run left on disk, so the
// arrangement is a real run directory in a temp repo — the summary is driven
// through the same reader the CLI uses, never stubbed. isTTY is pinned off so
// the ANSI paint helpers stay no-ops and the assertions read the plain text a
// piped consumer sees.
const setupResult = ({
	manifest = {},
	ok = true,
	error,
	commands = [],
	friction = [],
	rejectedReports = 0,
}: {
	manifest?: Partial<RunManifest>;
	ok?: boolean;
	error?: string;
	commands?: { durationMs?: number; rerun?: true; skipped?: true }[];
	friction?: FrictionRecord[];
	rejectedReports?: number;
} = {}) => {
	const logged: string[] = [];
	const errors: string[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	const fullManifest: RunManifest = {
		runId: 'run-1234-abcd',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:03.000Z',
		plan: '.notes/plans/feature.md',
		harness: 'claude-code',
		status: RunStatus.Passed,
		currentStep: null,
		steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1 }],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: [],
		testSubjects: [],
		ledgerTests: [],
		unreachableChangedFiles: [],
		coverageExcludedChangedFiles: [],
		...manifest,
	};

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-print-result-'));
	const runDir = join(cwd, '.lightsout', 'runs', fullManifest.runId);

	mkdirSync(runDir, { recursive: true });

	if (commands.length > 0) {
		writeFileSync(join(runDir, 'commands.jsonl'), `${commands.map((command) => JSON.stringify(command)).join('\n')}\n`);
	}

	if (friction.length > 0) {
		writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), `${friction.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
	}

	if (rejectedReports > 0) {
		mkdirSync(join(runDir, 'agents'));
		writeFileSync(join(runDir, 'agents', 'implement-1.json'), '{}');

		for (let index = 0; index < rejectedReports; index += 1) {
			writeFileSync(join(runDir, 'agents', `rejected-implement-${index}.json`), '{}');
		}
	}

	return { result: { ok, manifest: fullManifest, error }, cwd, logged, errors };
};

/** The labelled summary lines, with the step table's box-drawn rows and the blank spacers dropped. */
const labelLines = ({ logged }: { logged: string[] }) => logged.filter((line) => line !== '' && !/^[┌├└│]/.test(line));

test('printResult: a clean run with no usage, scope, or gate history prints only the always-present lines', async () => {
	const { result, cwd, logged, errors } = setupResult();

	await printResult({ result, cwd });

	expect(labelLines({ logged })).toStrictEqual([
		'run       run-1234 · PASSED',
		'plan      feature.md',
		'wall      3s',
		'gates     0s',
		'gates     0 commands',
		'evidence  .lightsout/runs/run-1234-abcd/',
	]);
	expect(errors).toStrictEqual([]);
});

test('printResult: a failed run reports active time, usage, gate detail, retries, this run’s friction, scope, and the error on stderr', async () => {
	const { result, cwd, logged, errors } = setupResult({
		ok: false,
		error: 'gate check failed: pnpm check',
		manifest: {
			status: RunStatus.Failed,
			updatedAt: '2026-01-01T00:02:05.000Z',
			steps: [
				{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 65000, changedFiles: ['src/a.ts'] },
				{ id: 'write-tests', status: RunStatus.Failed, attempts: 2, durationMs: 5000 },
			],
			usage: { invocations: 3, inputTokens: 1000, outputTokens: 2500, cacheReadTokens: 7000, cacheCreationTokens: 2000, costUsd: 1.234 },
			packages: ['api', 'web'],
			packagesSource: PackagesSource.FrontMatter,
		},
		commands: [{ durationMs: 1000 }, { durationMs: 2000, rerun: true }, { skipped: true }],
		friction: [
			{ at: '2026-01-01T00:00:01.000Z', runId: 'run-1234-abcd', step: 'implement', area: FrictionArea.Plan, detail: 'ambiguous scope' },
			{ at: '2026-01-01T00:00:02.000Z', runId: 'run-1234-abcd', step: 'write-tests', area: FrictionArea.Plan, detail: 'no fixture named' },
			{ at: '2026-01-01T00:00:03.000Z', runId: 'run-1234-abcd', step: 'write-tests', area: FrictionArea.Prompt, detail: 'role unclear' },
			{ at: '2026-01-01T00:00:04.000Z', runId: 'another-run', step: 'implement', area: FrictionArea.Environment, detail: 'belongs to a different run' },
		],
		rejectedReports: 1,
	});

	await printResult({ result, cwd });

	expect(labelLines({ logged })).toStrictEqual([
		'run       run-1234 · FAILED',
		'plan      feature.md',
		'wall      2m 05s',
		'active    1m 10s',
		'gates     3s',
		'tokens    in 1.0k · out 2.5k · cache-read 7.0k (70%)',
		'cost      $1.23 API-equivalent · 3 invocations',
		'gates     2 commands · 1 flake re-run · 1 skipped (no script)',
		'retries   1 rejected report re-emitted',
		'friction  3 · plan 2 · prompt 1',
		'scope     api · web (front-matter)',
		'evidence  .lightsout/runs/run-1234-abcd/',
	]);
	expect(errors).toStrictEqual(['\ngate check failed: pnpm check']);
});

test('printResult: an invocation that reported no tokens prints usage with no cache share, and the count reads singular', async () => {
	const { result, cwd, logged } = setupResult({
		manifest: { usage: { invocations: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 } },
	});

	await printResult({ result, cwd });

	expect(labelLines({ logged })).toStrictEqual([
		'run       run-1234 · PASSED',
		'plan      feature.md',
		'wall      3s',
		'gates     0s',
		'tokens    in 0 · out 0 · cache-read 0',
		'cost      $0.00 API-equivalent · 1 invocation',
		'gates     0 commands',
		'evidence  .lightsout/runs/run-1234-abcd/',
	]);
});

test('printResult: a scope with no recorded source prints bare, and a failure carrying no message writes nothing to stderr', async () => {
	const { result, cwd, logged, errors } = setupResult({ ok: false, manifest: { status: RunStatus.Failed, packages: ['api'] } });

	await printResult({ result, cwd });

	expect(labelLines({ logged })).toStrictEqual([
		'run       run-1234 · FAILED',
		'plan      feature.md',
		'wall      3s',
		'gates     0s',
		'gates     0 commands',
		'scope     api',
		'evidence  .lightsout/runs/run-1234-abcd/',
	]);
	expect(errors).toStrictEqual([]);
});

test('printResult: files that finished the run unreachable surface as a named warning line', async () => {
	const { result, cwd, logged } = setupResult({ manifest: { unreachableChangedFiles: ['src/orphan.ts', 'src/other.ts'] } });

	await printResult({ result, cwd });

	expect(labelLines({ logged })).toStrictEqual([
		'run       run-1234 · PASSED',
		'plan      feature.md',
		'wall      3s',
		'gates     0s',
		'gates     0 commands',
		'warning   unreachable-changed-files: src/orphan.ts, src/other.ts — changed, but no public surface reaches them; no tests cover them',
		'evidence  .lightsout/runs/run-1234-abcd/',
	]);
});
