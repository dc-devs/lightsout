import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { repairPhaseBreakdown } from '#src/plan/index.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

/** An overview whose phases declare the given created-file counts — anything over 30 is the blocking size defect. */
const overviewCreating = ({ counts }: { counts: number[] }) =>
	overviewBody({ rows: counts.map((created, index) => ({ number: index + 1, file: `phase${index + 1}-step.md`, created, touched: 1 })) });

/** A plan workspace holding one authored overview, ready for the reshape loop. */
const setupOverview = ({ overview = overviewCreating({ counts: [1] }) }: { overview?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-breakdown-'));
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(workspaceDir, { recursive: true });

	const overviewPath = join(workspaceDir, 'overview.md');

	writeFileSync(overviewPath, overview);

	return { cwd, workspaceDir, overviewPath, messages: [] as string[] };
};

/** A reshaper that rewrites the overview with successive bodies — or hands the call to `respond` when given. */
const reshapeDriver = ({
	bodies = [],
	onCall,
	respond,
}: {
	bodies?: string[];
	onCall?: (prompt: string) => void;
	respond?: ({ path }: { path: string }) => { text: string; exitCode: number; rateLimited?: boolean };
}): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async ({ prompt }) => {
			onCall?.(prompt);

			const path = /- (\S+overview\.md)/.exec(prompt)?.[1] ?? '';

			if (respond) {
				return respond({ path });
			}

			const body = bodies[Math.min(call, bodies.length - 1)] ?? '';

			call += 1;
			writeFileSync(path, body);

			return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
		},
	};
};

const run = ({
	cwd,
	workspaceDir,
	overviewPath,
	driver,
	brainstormDecisionsPath,
	progress = () => {},
}: {
	cwd: string;
	workspaceDir: string;
	overviewPath: string;
	driver: Driver;
	brainstormDecisionsPath?: string;
	progress?: (message: string) => void;
}) =>
	repairPhaseBreakdown({ cwd, driver, name: 'demo', overviewPath, workspaceDir, brainstormDecisionsPath, executorFileLimit: 50, timeoutMs: 60_000, progress });

describe('repairPhaseBreakdown', () => {
	test('a breakdown that already fits converges without spending a reshape', async () => {
		const overview = setupOverview();
		let calls = 0;

		const result = await run({ ...overview, driver: reshapeDriver({ onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		expect({ findings: result.findings, calls }).toStrictEqual({ findings: [], calls: 0 });
	});

	test('an advisory-only breakdown spends no reshape and still hands the note back', async () => {
		const overview = setupOverview({ overview: overviewBody({ rows: [{ number: 1, file: 'phase1-step.md', created: 1, touched: 51 }] }) });
		let calls = 0;

		const result = await run({ ...overview, driver: reshapeDriver({ onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		// an advisory is not a defect: spending one of the three attempts on it
		// would buy nothing and could cost the breakdown a real reshape
		expect({ severities: result.findings.map(({ check, severity }) => ({ check, severity })), calls }).toStrictEqual({
			severities: [{ check: StructuralCheck.ScopeWithinGuardrail, severity: FindingSeverity.Advisory }],
			calls: 0,
		});
	});

	test('an over-ceiling phase is reshaped in one round and comes back clean', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		let calls = 0;
		const driver = reshapeDriver({ bodies: [overviewCreating({ counts: [16, 15] })], onCall: () => (calls += 1) });

		const result = await run({ ...overview, driver });

		expectStatus(result, 'complete');
		// the re-split is the reshaper's whole job, and the re-check is what
		// decides whether it worked
		expect({ findings: result.findings, calls }).toStrictEqual({ findings: [], calls: 1 });
		expect(readFileSync(overview.overviewPath, 'utf8')).toContain('| 2 | `phase2-step.md` |');
	});

	test('an overview that is not on disk fails rather than reshaping nothing', async () => {
		const overview = setupOverview();
		const missingPath = join(overview.workspaceDir, 'nowhere.md');

		const result = await run({ ...overview, overviewPath: missingPath, driver: reshapeDriver({}) });

		expectStatus(result, 'failed');
		// a spawn that claimed to write the overview and did not is a failure, not
		// a clean breakdown
		expect(result.error).toBe(`overview could not be read at ${missingPath}`);
	});

	test('a reshaper that deletes the overview fails on the re-check rather than reporting it converged', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		const driver = reshapeDriver({
			respond: ({ path }) => {
				rmSync(path);

				return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
			},
		});

		const result = await run({ ...overview, driver });

		expectStatus(result, 'failed');
		expect(result.error).toContain('could not be read');
	});

	test('a rate-limited reshape parks with the re-run command, leaving the overview on disk', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });

		const result = await run({ ...overview, driver: reshapeDriver({ respond: () => ({ text: '', exitCode: 1, rateLimited: true }) }) });

		expectStatus(result, 'paused-rate-limit');
		expect(result.error).toContain('lightsout plan draft --name demo');
		// the draft survives for the re-run to overwrite
		expect(readFileSync(overview.overviewPath, 'utf8')).toContain('| 1 | `phase1-step.md` | the work | 31 |');
	});

	test('a reshape invocation failure returns failed instead of looping', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('spawn failed');
			},
		};

		const result = await run({ ...overview, driver });

		expectStatus(result, 'failed');
		expect(result.error).toMatch(/spawn failed/);
	});

	test('a reshape that leaves the finding set identical stops the loop instead of burning the budget', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		let calls = 0;
		const driver = reshapeDriver({ bodies: [overviewCreating({ counts: [31] })], onCall: () => (calls += 1) });

		const result = await run({ ...overview, driver, progress: () => {} });

		expectStatus(result, 'complete');
		// every round gets identical inputs, so an unchanged set predicts an
		// unchanged retry
		expect({ calls, surviving: result.findings.map(({ check }) => check) }).toStrictEqual({
			calls: 1,
			surviving: [StructuralCheck.CreatedFilesWithinCeiling],
		});
	});

	test('reshapes that shrink but never clear the findings exhaust the three-attempt budget', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31, 31, 31] }) });
		let calls = 0;
		// 3 → 2 → 1 → 1 over-ceiling phases: every round is real progress, so the
		// loop runs to the cap rather than tripping the no-progress exit
		const driver = reshapeDriver({
			bodies: [overviewCreating({ counts: [31, 31, 1] }), overviewCreating({ counts: [31, 1, 1] }), overviewCreating({ counts: [31, 1, 1] })],
			onCall: () => (calls += 1),
		});

		const result = await run({ ...overview, driver });

		expectStatus(result, 'complete');
		// the survivors ride the result for the caller to hand back
		expect({ calls, surviving: result.findings.length }).toStrictEqual({ calls: 3, surviving: 1 });
	});

	test('a declined reshape narrates each discrepancy and stops, with the survivors coming from the re-check', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31, 31] }) });
		const messages: string[] = [];
		const driver = reshapeDriver({
			respond: ({ path }) => {
				writeFileSync(path, overviewCreating({ counts: [31, 1] }));

				return {
					text: JSON.stringify({
						status: 'error',
						filesEdited: [path],
						discrepancies: ['phase 1 cannot be split without a decision', 'the facts name no seam here'],
					}),
					exitCode: 0,
				};
			},
		});

		const result = await run({ ...overview, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// the decline stops the loop, but the surviving set is what the check
		// says now — not the stale pre-reshape list
		expect(result.findings.length).toBe(1);
		expect(messages.filter((message) => message.includes('declined'))).toEqual([
			expect.stringContaining('phase 1 cannot be split without a decision'),
			expect.stringContaining('the facts name no seam here'),
		]);
	});

	test('a declined reshape whose edits fixed the breakdown returns no survivors — the check decides, not the report', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		let calls = 0;
		const driver = reshapeDriver({
			respond: ({ path }) => {
				calls += 1;
				writeFileSync(path, overviewCreating({ counts: [16, 15] }));

				return { text: JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ['declared unresolvable, yet split'] }), exitCode: 0 };
			},
		});

		const result = await run({ ...overview, driver });

		expectStatus(result, 'complete');
		expect({ findings: result.findings, calls }).toStrictEqual({ findings: [], calls: 1 });
	});

	test('each round is narrated with its number and the findings it is being spent on', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31, 31] }) });
		const messages: string[] = [];
		const driver = reshapeDriver({ bodies: [overviewCreating({ counts: [31, 1] }), overviewCreating({ counts: [1, 1] })] });

		const result = await run({ ...overview, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// the human watching a draft converge sees the count fall round by round
		expect(messages).toEqual([
			expect.stringMatching(/2 phase-breakdown finding\(s\).*reshape 1\/3/),
			expect.stringMatching(/1 phase-breakdown finding\(s\).*reshape 2\/3/),
		]);
	});

	test('the no-progress exit says why it stopped rather than going quiet', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		const messages: string[] = [];

		const result = await run({
			...overview,
			driver: reshapeDriver({ bodies: [overviewCreating({ counts: [31] })] }),
			progress: (message) => messages.push(message),
		});

		expectStatus(result, 'complete');
		expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/reshape 1 made no progress/)]));
	});

	test('the reshaper is pointed at the ceiling and the workspace records, never handed their contents', async () => {
		const overview = setupOverview({ overview: overviewCreating({ counts: [31] }) });
		const prompts: string[] = [];
		const driver = reshapeDriver({ bodies: [overviewCreating({ counts: [16, 15] })], onCall: (prompt) => prompts.push(prompt) });

		const result = await run({ ...overview, driver, brainstormDecisionsPath: join(overview.workspaceDir, 'brainstorm-decisions.json') });

		expectStatus(result, 'complete');
		// the reshaper splits against the same number the check applies, and
		// reads the records on demand rather than carrying them in its prompt
		expect(prompts[0]).toContain('No phase may declare more than 30 created source files');
		expect(prompts[0]).toContain(`- Decisions record: ${join(overview.workspaceDir, 'decisions.json')}`);
		expect(prompts[0]).toContain(`- Verified facts: ${join(overview.workspaceDir, 'facts.json')}`);
		expect(prompts[0]).toContain(join(overview.workspaceDir, 'brainstorm-decisions.json'));
		expect(prompts[0]).toContain(`[${StructuralCheck.CreatedFilesWithinCeiling}]`);
	});
});
