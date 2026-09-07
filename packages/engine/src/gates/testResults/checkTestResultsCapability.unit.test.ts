import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/index.ts';
import { checkTestResultsCapability } from '#src/gates/index.ts';

/** One reported test file, shaped as the reporter writes it: an absolute path and one passing assertion. */
const reportedFile = ({ cwd, file, title }: { cwd: string; file: string; title: string }) => ({
	testFilePath: join(cwd, file),
	assertionResults: [{ title, ancestorTitles: [], fullName: title, status: 'passed', durationMs: 1 }],
});

/**
 * A repo whose gate executions each own a results directory under the run folder.
 * `tests` omitted leaves that directory created and empty — the gate ran green and
 * the reporter wrote nothing, which is the failure this probe exists for.
 * `skipped` gives a scoped skip instead, which carries no directory at all.
 */
const setupProbe = ({
	executions,
}: {
	executions: { kind: string; group?: string; tests?: { file: string; title: string }[]; exitCode?: number; skipped?: true }[];
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-capability-'));

	const results: GateResult[] = executions.map(({ kind, group = 'root', tests, exitCode = 0, skipped }) => {
		if (skipped) {
			return { kind, group, command: `gate ${kind}`, skipped, reason: `no "${kind}" script` };
		}

		const dir = join('.lightsout', 'runs', 'probe-run', 'test-results', 'clean-slate', group, kind);

		mkdirSync(join(cwd, dir), { recursive: true });

		if (tests) {
			writeFileSync(join(cwd, dir, 'jest-1.json'), JSON.stringify({ testResults: tests.map(({ file, title }) => reportedFile({ cwd, file, title })) }));
		}

		return { kind, group, command: `gate ${kind}`, exitCode, testResultsDir: dir };
	});

	return { cwd, results };
};

test('checkTestResultsCapability: names each ledger gate that produced no results and how to enable the reporter', async () => {
	const { cwd, results } = setupProbe({ executions: [{ kind: 'test-unit' }, { kind: 'test-e2e' }] });

	const error = await checkTestResultsCapability({ cwd, gates: ['test-unit', 'test-e2e'], results });

	expect(error).toEqual(expect.stringContaining('test-unit'));
	expect(error).toEqual(expect.stringContaining('test-e2e'));
	expect(error).toEqual(expect.stringContaining('LIGHTSOUT_JEST_REPORTER'));
	expect(error).toEqual(expect.stringContaining('LIGHTSOUT_TEST_RESULTS_DIR'));
	expect(error).toEqual(expect.stringContaining('reporters'));
	// only a jest gate loading the reporter can prove a row, and the message has to say so
	expect(error).toMatch(/jest/i);
});

test('checkTestResultsCapability: passes when every ledger gate wrote results', async () => {
	const { cwd, results } = setupProbe({
		executions: [
			{ kind: 'test-unit', tests: [{ file: 'src/widget.unit.test.ts', title: 'widget: renders' }] },
			{ kind: 'test-e2e', group: 'api', tests: [{ file: 'packages/api/src/route.e2e.test.ts', title: 'route: answers' }] },
		],
	});

	const error = await checkTestResultsCapability({ cwd, gates: ['test-unit', 'test-e2e'], results });

	expect(error).toBe(undefined);
});

test('checkTestResultsCapability: skips a ledger gate that did not run, and says so', async () => {
	const { cwd, results } = setupProbe({
		executions: [
			{ kind: 'test', tests: [{ file: 'src/widget.unit.test.ts', title: 'widget: renders' }] },
			{ kind: 'test-e2e', group: 'api', skipped: true },
		],
	});
	const progress: string[] = [];

	const error = await checkTestResultsCapability({ cwd, gates: ['test-e2e'], results, onProgress: (message) => progress.push(message) });

	expect(error).toBe(undefined);
	// narrated:\n${progress.join('\n')}
	expect(progress.some((line) => line.includes('test-e2e'))).toBeTruthy();
});

test('checkTestResultsCapability: fails a ledger gate when one package group wrote no results, naming the group', async () => {
	const { cwd, results } = setupProbe({
		executions: [
			{ kind: 'test', group: 'alpha', tests: [{ file: 'packages/alpha/src/widget.unit.test.ts', title: 'widget: renders' }] },
			{ kind: 'test', group: 'beta' },
		],
	});

	const error = await checkTestResultsCapability({ cwd, gates: ['test'], results });

	expect(error).toEqual(expect.stringContaining('beta'));
	expect(error).toEqual(expect.stringContaining('LIGHTSOUT_JEST_REPORTER'));
});
