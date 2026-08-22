import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DedupReport, Effort, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDedup } from '#src/plan/runPlanDedup.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';

/** A temp repo holding the given existing source files, each a one-export module. */
const seedRepo = ({ existing }: { existing: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-run-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	return cwd;
};

/** A plan body whose Files to Create names each given path. */
const planBody = ({ title, creates }: { title: string; creates: string[] }) =>
	`# ${title}\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;

/** A temp repo with the given existing source files and a single-file plan at `.lightsout/plans/<name>/plan.md`. */
const setup = ({ existing, creates, name = 'p' }: { existing: string[]; creates: string[]; name?: string }) => {
	const cwd = seedRepo({ existing });
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), planBody({ title: 'Plan', creates }));

	return { cwd, name };
};

/** The one line only the overview carries, so a prompt can be told apart from the phases it fronts. */
const overviewMarker = 'Phase 2 follows phase 1.';

/**
 * A temp repo whose plan is phased: an `overview.md` fronting one
 * `phase<N>-part.md` per entry in `phases`, all in the plan's own folder.
 */
const setupPhased = ({ existing, phases, name = 'p' }: { existing: string[]; phases: string[][]; name?: string }) => {
	const cwd = seedRepo({ existing });
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'overview.md'), `# Plan — Overview\n\n## Cross-Phase Dependencies\n\n- ${overviewMarker}\n`);

	phases.forEach((creates, index) => {
		writeFileSync(join(dir, `phase${index + 1}-part.md`), planBody({ title: `Phase ${index + 1}`, creates }));
	});

	return { cwd, name };
};

/** A dedup-judge stub returning a fixed verdict set, counting its invocations. */
const judgeDriver = (verdicts: unknown[], calls: { count: number }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		calls.count += 1;

		// dedup invocation marker present
		expect(prompt.includes('# Dedup input')).toBeTruthy();
		// detected-collisions section present
		expect(prompt.includes('## Detected name collisions')).toBeTruthy();

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

/**
 * A plan whose workspace has a directory squatting on the path each rejected
 * payload wants to be written to, so saving that evidence fails with `EISDIR`.
 */
const setupUnwritableEvidence = () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const workspaceDir = join(cwd, '.lightsout', 'plans', name);

	// one per attempt: the first judgment and its single re-emit retry, under the
	// per-plan-file step the fan-out names each judge's evidence with
	mkdirSync(join(workspaceDir, 'dedup-plan-rejected-1.txt'));
	mkdirSync(join(workspaceDir, 'dedup-plan-rejected-2.txt'));

	return { cwd, name, workspaceDir };
};

/** A dedup-judge stub that records every invocation it is handed, returning the given verdicts (none by default). */
const recordingJudgeDriver = (invocations: DriverInvocation[], verdicts: unknown[] = []): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

test('plan dedup: a confirmed duplicate becomes a DedupFinding', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdict = { plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' };
	const result = await runPlanDedup({ cwd, driver: judgeDriver([verdict], calls), name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	// the judge was invoked once
	expect(calls.count).toBe(1);
	expect(result.dedup.findings.length).toBe(1);
	expect(result.dedup.findings[0]?.plannedSymbol).toBe('getUser');
	expect(result.dedup.findings[0]?.recommendation).toBe('reuse');
	expect(result.dedup.findings[0]?.collidesWith.some((collision) => collision.name === 'fetchUser')).toBeTruthy();

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	// dedup.json written
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// the file on disk is what the ignition skill reads, so it carries the plan's
	// name and the confirmed duplication — not merely a schema-valid shape
	expect(persisted.planName).toBe('p');
	expect(persisted.findings.map(({ plannedSymbol, recommendation }) => ({ plannedSymbol, recommendation }))).toStrictEqual([
		{ plannedSymbol: 'getUser', recommendation: 'reuse' },
	]);
});

test('plan dedup: an isDuplicate:false verdict is dropped', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdict = { plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' };
	const result = await runPlanDedup({ cwd, driver: judgeDriver([verdict], calls), name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(calls.count).toBe(1);
	expect(result.dedup.findings).toStrictEqual([]);
});

test('plan dedup: a phased plan is judged one agent per plan file, each given only its own file and its own collisions', async () => {
	const { cwd, name } = setupPhased({
		existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'],
		phases: [['src/getUser.ts'], ['src/getOrder.ts']],
	});
	const invocations: DriverInvocation[] = [];
	const verdicts = [
		{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' },
		{ plannedSymbol: 'getOrder', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchOrder already does this' },
	];
	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations, verdicts), name });

	expectStatus(result, 'complete');
	// one judge per plan file — gluing every phase into one prompt is the
	// single-agent-whole-plan shape this fan-out replaces
	expect(invocations.length).toBe(2);
	// and each judge sees exactly one file's collisions
	expect(invocations.map(({ prompt }) => [prompt.includes('getUser'), prompt.includes('getOrder')])).toStrictEqual([
		[true, false],
		[false, true],
	]);
	// both phases' planned symbols came back as findings, in plan-file order
	expect(result.dedup.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([
		['getUser', 'phase1-part.md'],
		['getOrder', 'phase2-part.md'],
	]);
	// the overview rides every system prompt as context, never the text under judgment
	expect(invocations.every(({ systemPrompt }) => (systemPrompt ?? '').includes(overviewMarker))).toBeTruthy();
	expect(invocations.some(({ prompt }) => prompt.includes(overviewMarker))).toBeFalsy();
	// the report lands in the plan's own folder, beside the phases it judged
	expect(result.dedupPath).toBe(join(cwd, '.lightsout', 'plans', name, 'dedup.json'));
});

test('plan dedup: no candidates → empty report and no agent call', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when there are no candidates');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(result.dedup.findings).toStrictEqual([]);

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	// dedup.json still written on the no-op path
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// a clean result is a real report naming the plan with no findings, never an
	// empty or absent file the skill would have to special-case
	expect(persisted.planName).toBe('p');
	expect(persisted.findings).toStrictEqual([]);
});

test('plan dedup: a missing deliverable fails with the plan workspace already created', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-missing-'));
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when the deliverable does not resolve');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates
	expect('error' in result && /no plan found for 'ghost'/.test(result.error)).toBeTruthy();
	expect(result.workspaceDir).toBe(join(cwd, '.lightsout', 'plans', 'ghost'));
	// the workspace is created before the resolve, so a failure still has
	// somewhere to report from
	expect(existsSync(result.workspaceDir)).toBeTruthy();
});

test('plan dedup: the resolved model, effort and permissions reach the harness', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const result = await runPlanDedup({
		cwd,
		driver: recordingJudgeDriver(invocations),
		name,
		model: 'gpt-5.2',
		effort: Effort.XHigh,
		permissions: Permissions.FullAccess,
	});

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'full-access' },
	]);
});

test('plan dedup: an unset effort or permissions is forwarded absent — this role invents no default', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations), name });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: undefined, effort: undefined, permissions: undefined },
	]);
});

test('plan dedup: no deliverable on disk fails before any detection or judging', async () => {
	const { cwd } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when the plan cannot be resolved');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
});

test('plan dedup: a rate-limited judge parks the run and writes an incomplete report rather than discarding the scan', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// a rate limit buys no re-emit retry
	expect(calls).toBe(1);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes(`lightsout plan dedup --name ${name}`)).toBeTruthy();

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	// the report IS written, marked incomplete — an empty findings list from a
	// parked scan must never read as "no duplication found"
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	expect(persisted.findings).toStrictEqual([]);
	expect(persisted.complete).toBe(false);
	expect(persisted.incompleteReason ?? '').toMatch(/plan\.md: rate limited or overloaded/);
});

test('plan dedup: a judge whose output never satisfies the contract fails, keeping the scan marked incomplete', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'they all look distinct to me', exitCode: 0 };
		},
	};
	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// the rejected report bought exactly one re-emit retry
	expect(calls).toBe(2);
	// the failure names the plan file whose judge died, got: ${result.error}
	expect('error' in result && /dedup judge failed for plan\.md/.test(result.error ?? '')).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json'), 'utf8')));

	// what finished is kept, marked incomplete
	expect(persisted.complete).toBe(false);
});

test('plan dedup: evidence that cannot be saved never replaces the judging failure it was recording', async () => {
	const { cwd, name, workspaceDir } = setupUnwritableEvidence();
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'they all look distinct to me', exitCode: 0 };
		},
	};

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// saving the rejected payload is best-effort: a failed write is swallowed, so
	// the step still buys its re-emit retry and reports why judging failed rather
	// than rejecting with the filesystem error
	expect(calls).toBe(2);
	expect('error' in result && /dedup judge failed/.test(result.error ?? '')).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(join(workspaceDir, 'dedup.json'), 'utf8')));

	expect(persisted.complete).toBe(false);
});

test('plan dedup: progress narrates the candidates detected and the duplications to review', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const verdict = { plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' };
	const messages: string[] = [];

	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver([], [verdict]), name, onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// the human waiting on the judge sees what was detected and what came back,
	// got: ${messages.join(' | ')}
	expect(messages).toEqual([
		expect.stringMatching(/1 candidate\(s\) detected across 1 plan file\(s\), judging/),
		expect.stringMatching(/1 duplication\(s\) to review/),
	]);
});

test('plan dedup: the no-candidate path narrates that there is nothing to review', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when there are no candidates');
		},
	};
	const messages: string[] = [];

	const result = await runPlanDedup({ cwd, driver: failIfCalled, name, onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// a silent no-op reads as a hang; the narration says the pass ran and found nothing
	expect(messages).toEqual([expect.stringMatching(/no prior-art candidates/)]);
});

test('plan dedup: an explicit timeoutMs reaches the judging harness', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];

	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations), name, timeoutMs: 90_000 });

	expectStatus(result, 'complete');
	// the caller's ceiling is what kills a hung judge, not this role's own
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([90_000]);
});

test('plan dedup: an omitted timeoutMs falls back to the thirty-minute ceiling', async () => {
	const { cwd, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];

	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations), name });

	expectStatus(result, 'complete');
	// a judging spawn is never left to run forever just because no ceiling was given
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([30 * 60 * 1000]);
});

test('plan dedup: a plan file with no collisions spawns no judge, while its sibling still gets one', async () => {
	const { cwd, name } = setupPhased({
		existing: ['src/fetchUser.ts'],
		phases: [['src/getUser.ts'], ['src/brandNewWidget.ts']],
	});
	const invocations: DriverInvocation[] = [];
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' }];
	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations, verdicts), name });

	expectStatus(result, 'complete');
	// the no-candidates-no-agent rule is now per plan file rather than per plan
	expect(invocations.length).toBe(1);
	expect(invocations[0]?.prompt.includes('getUser')).toBeTruthy();
	expect(invocations[0]?.prompt.includes('brandNewWidget')).toBeFalsy();
	expect(result.dedup.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([['getUser', 'phase1-part.md']]);
	// nothing failed, so the scan speaks for the whole plan
	expect(result.dedup.complete).toBe(true);
});

test('plan dedup: one failed judge never discards what the other plan files returned', async () => {
	const { cwd, name } = setupPhased({
		existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'],
		phases: [['src/getUser.ts'], ['src/getOrder.ts']],
	});
	const verdict = { plannedSymbol: 'getOrder', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchOrder already does this' };
	// Only phase 1's judge never satisfies the contract — and neither does its
	// re-emit retry, whose prompt carries the rejected text back rather than the
	// plan file that earned it.
	const stumped = 'phase 1 has me stumped';
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) =>
			prompt.includes('getUser') || prompt.includes(stumped) ? { text: stumped, exitCode: 0 } : { text: JSON.stringify({ verdicts: [verdict] }), exitCode: 0 },
	};
	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// the failure names only the plan file whose judge died, got: ${result.error}
	expect('error' in result && (result.error ?? '')).toMatch(/dedup judge failed for phase1-part\.md:/);
	expect('error' in result && (result.error ?? '')).not.toMatch(/phase2-part\.md/);

	const persisted = DedupReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json'), 'utf8')));

	// the surviving judge's finding is kept — a partial scan is persisted rather
	// than thrown away, and marked for what it is
	expect(persisted.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([['getOrder', 'phase2-part.md']]);
	expect(persisted.complete).toBe(false);
	expect(persisted.incompleteReason ?? '').toMatch(/^phase1-part\.md: /);
});
