import { describe, expect, test } from '@jest/globals';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';

/**
 * A resumed run whose seeded evidence makes the end-of-run summary worth
 * reading: one finished step carrying a duration, a file list and recorded
 * agent spend, plus the run-wide usage totals. The resumed pipeline still stops
 * at its own plan read, so the summary renders over exactly this state.
 */
const setupResumeSummary = () =>
	setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: 'implement',
			steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 2, durationMs: 65_000, changedFiles: ['src/a.ts', 'src/b.ts'] }],
			usage: { invocations: 3, inputTokens: 1_000_000, outputTokens: 3_400, cacheReadTokens: 600_000, cacheCreationTokens: 400_000, costUsd: 1.5 },
		}),
		evidence: { ledger: [{ step: 'implement', outputTokens: 3_400, costUsd: 1.5 }] },
	});

/** Three entries this run reported, and a fourth from another run sharing the log — which must not be counted against this one. */
const seededFriction = [
	{ at: '2026-01-01T00:00:01.000Z', runId, step: 'implement', area: 'plan', detail: 'the plan named no owner' },
	{ at: '2026-01-01T00:00:02.000Z', runId, step: 'write-tests', area: 'plan', detail: 'the mirror file used the older style' },
	{ at: '2026-01-01T00:00:03.000Z', runId, step: 'implement', area: 'environment', detail: 'the jest config lacked clearMocks' },
	{ at: '2026-01-01T00:00:04.000Z', runId: 'run-elsewhere', step: 'implement', area: 'prompt', detail: 'not this run' },
];

/**
 * A resumed run carrying the evidence the report card's conditional lines read:
 * a recorded package scope and where it came from, changed files no public
 * surface reaches, the friction its agents reported, and a report that failed
 * its contract and cost a re-emit. The resumed pipeline stops at its own plan
 * read, so none of it is overwritten before the summary renders.
 */
const setupResumeEvidence = () =>
	setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: 'implement',
			packages: ['api', 'web'],
			packagesSource: 'flag',
			unreachableChangedFiles: ['src/orphan.ts', 'src/stray.ts'],
		}),
		evidence: { friction: seededFriction, rejectedReports: ['rejected-implement-1.json', 'implement-1.json'] },
	});

/** The step-table rows the summary printed, each split back into its trimmed cell values. */
const tableRows = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((row) =>
			row
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

describe('resumeCommand run summary', () => {
	test('the run summary tables each finished step — its outcome icon, tries, active time, agent spend and the files it touched', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// 65s crosses the minute mark, so the time reads as minutes and zero-padded seconds
		expect(tableRows({ logged })).toContainEqual(['✓ implement', '2', '1m 05s', '1', '3.4k', '$1.50', '2']);
	});

	test('a step the run never got to renders every unknown column as an em dash rather than a zero', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan read stops the run at clean-slate: no duration, no invocation, no files
		expect(tableRows({ logged })).toContainEqual(['✗ clean-slate', '0', '—', '—', '—', '—', '—']);
	});

	test('the totals line sums the run — active time, invocations, output tokens, cost and files — and never a try count', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(tableRows({ logged })).toContainEqual(['total', '—', '1m 05s', '1', '3.4k', '$1.50', '2']);
	});

	test('the run-wide spend is reported in scaled token counts, with the share the model read from cache', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// 600k of the 2M readable input came from cache
		expect(logged).toContain('tokens    in 1.0M · out 3.4k · cache-read 600.0k (30%)');
		expect(logged).toContain('cost      $1.50 API-equivalent · 3 invocations');
	});

	test('the report card names the package scope the run worked in, and where that scope came from', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// a scope a reader cannot trace back to a flag, front matter or the plan paths is a scope they cannot argue with
		expect(logged).toContain('scope     api · web (flag)');
	});

	test('changed files no public surface reaches are reported as a warning, never left silent', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(
			'warning   unreachable-changed-files: src/orphan.ts, src/stray.ts — changed, but no public surface reaches them; no tests cover them',
		);
	});

	test('friction is totalled and broken down by area, counting only what this run reported', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the fourth log entry belongs to another run, so the total is 3 rather than 4
		expect(logged).toContain('friction  3 · plan 2 · environment 1');
	});

	test('a report that failed its contract is counted as a retry, so a re-emit never passes unnoticed', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// only the rejected- prefixed file counts; the accepted report beside it does not
		expect(logged).toContain('retries   1 rejected report re-emitted');
	});
});
