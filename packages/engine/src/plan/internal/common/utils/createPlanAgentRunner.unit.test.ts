import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { z } from 'zod';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import type { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { createPlanAgentRunner } from '#src/plan/internal/common/utils/createPlanAgentRunner.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';

const Contract = z.object({ ok: z.boolean() });

/**
 * A harness stub that streams the given events before answering. Each answer is
 * consumed in order, so one runner can be driven through several invocations.
 */
const stubDriver = ({ answers, events = [] }: { answers: string[]; events?: unknown[][] }): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async (invocation) => {
			const index = call;

			call += 1;

			for (const event of events[index] ?? []) {
				invocation.onEvent?.(event);
			}

			return { text: answers[index] ?? '', exitCode: 0 };
		},
	};
};

const setupWorkspace = () => mkdtempSync(join(tmpdir(), 'lightsout-plan-agent-'));

/**
 * The transcript lines once `count` of them have landed. The sink appends
 * through a promise tail nothing awaits — by design, so a slow disk never
 * stalls a harness read loop — so the file trails the invocation it came from.
 */
const readTranscript = async ({ path, count }: { path: string; count: number }) => {
	for (let attempt = 1; attempt <= 100; attempt += 1) {
		const raw = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : '';
		const lines = raw === '' ? [] : raw.split('\n');

		if (lines.length >= count) {
			return lines;
		}

		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	throw new Error(`transcript never reached ${count} line(s): ${path}`);
};

/** One level a runner opened: its id, what kind of level it is, and its label. */
interface OpenedLevel {
	id: string;
	level: string;
	label: string;
}

/**
 * A command-run level whose children are visible from outside.
 *
 * Every child it opens is collected, and every harness process recorded under
 * any level — the command run itself included — is collected by the id of the
 * level it landed on. A step level the chokepoint never received therefore
 * shows up as a process recorded on the parent rather than on the step.
 */
const setupLevel = () => {
	const opened: OpenedLevel[] = [];
	const recordedOn: string[] = [];
	const closed: { id: string; outcome: RunStatus }[] = [];

	const levelWithId = (id: string): ActivityLevel => ({
		id,
		open: ({ level, label }) => {
			const child = levelWithId(`${id}/${level}-${opened.length + 1}`);

			opened.push({ id: child.id, level, label });

			return child;
		},
		close: ({ outcome }) => {
			closed.push({ id, outcome });
		},
		recordProcess: () => {
			recordedOn.push(id);
		},
		settled: async () => undefined,
	});

	return { level: levelWithId('command-run'), opened, recordedOn, closed };
};

describe('createPlanAgentRunner', () => {
	test('tees the harness stream to the step transcript, one JSON line per event', async () => {
		const workspaceDir = setupWorkspace();
		const driver = stubDriver({ answers: [JSON.stringify({ ok: true })], events: [[{ n: 1 }, { n: 2 }]] });
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'dedup' });

		const { report } = outcomeFields(await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract }));

		expect(report).toStrictEqual({ ok: true });

		const lines = await readTranscript({ path: join(workspaceDir, 'dedup-stream.jsonl'), count: 2 });

		expect(lines).toStrictEqual(['{"n":1}', '{"n":2}']);
	});

	test('keeps one ordered transcript across every invocation of the same step', async () => {
		const workspaceDir = setupWorkspace();
		const answer = JSON.stringify({ ok: true });
		const driver = stubDriver({ answers: [answer, answer], events: [[{ phase: 1 }], [{ phase: 2 }]] });
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'grade' });

		// grade invokes the agent once per plan file — a per-call sink would let
		// the second file's first write race the first file's last one
		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract, label: 'phase1.md' });
		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract, label: 'phase2.md' });

		const lines = await readTranscript({ path: join(workspaceDir, 'grade-stream.jsonl'), count: 2 });

		expect(lines).toStrictEqual(['{"phase":1}', '{"phase":2}']);
	});

	test('saves a payload that failed the contract as evidence, named for the step and attempt', async () => {
		const workspaceDir = setupWorkspace();
		const driver = stubDriver({ answers: ['not json at all', 'still not json'] });
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'draft' });

		const { report } = outcomeFields(await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract }));

		expect(report).toBe(undefined);
		// one file per attempt, so a re-emit retry never overwrites the original
		expect(
			readdirSync(workspaceDir)
				.filter((name) => name.startsWith('draft-rejected-'))
				.sort(),
		).toStrictEqual(['draft-rejected-1.txt', 'draft-rejected-2.txt']);
		expect(readFileSync(join(workspaceDir, 'draft-rejected-1.txt'), 'utf8')).toBe('not json at all');
	});

	test('relays the re-run ceiling, and the spawn number keeps rising across both role attempts', async () => {
		const workspaceDir = setupWorkspace();
		// Valid JSON the contract turns down, so every rung still earns its cheap re-emit.
		const offContractObject = JSON.stringify({ ok: 'yes' });
		const driver = stubDriver({ answers: [offContractObject, offContractObject, offContractObject, offContractObject] });
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'grade', maxRoleAttempts: 2 });

		const { report, failure } = outcomeFields(await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract }));

		expect(report).toBe(undefined);
		expect(failure).toEqual(expect.stringContaining('did not match contract'));
		// Two role invocations, each with its own re-emit. The number naming the
		// file counts spawns and never restarts, so the first role attempt's
		// evidence — the very thing a rejected reader is diagnosed from — is still
		// on disk after the second attempt has written its own.
		expect(
			readdirSync(workspaceDir)
				.filter((name) => name.startsWith('grade-rejected-'))
				.sort(),
		).toStrictEqual(['grade-rejected-1.txt', 'grade-rejected-2.txt', 'grade-rejected-3.txt', 'grade-rejected-4.txt']);
	});

	test('a label distinguishes rejected payloads when one step runs per plan file', async () => {
		const workspaceDir = setupWorkspace();
		const driver = stubDriver({ answers: ['nope', 'nope'] });
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'grade' });

		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract, label: 'phase1.md' });

		expect(readdirSync(workspaceDir).sort()).toStrictEqual(['grade-rejected-phase1.md-1.txt', 'grade-rejected-phase1.md-2.txt']);
	});

	test('relays the invocation grant so a step can hand the agent a command prefix', async () => {
		const workspaceDir = setupWorkspace();
		const granted: (string[] | undefined)[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				granted.push(invocation.allowedCommands);

				return { text: JSON.stringify({ ok: true }), exitCode: 0 };
			},
		};
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'draft' });

		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract, allowedCommands: ['node cli plan lint'] });

		expect(granted).toStrictEqual([['node cli plan lint']]);
	});

	test('relays a requested environment and adds none when it is absent', async () => {
		const workspaceDir = setupWorkspace();
		const requested: (AgentEnvironment | undefined)[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				requested.push(invocation.environment);

				return { text: JSON.stringify({ ok: true }), exitCode: 0 };
			},
		};
		const environment: AgentEnvironment = {
			noMcpServers: true,
			noSkillCatalog: true,
			toolAllowlist: true,
			settingsPreserved: true,
			tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
		};
		const invokeFocused = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'draft', environment });
		const invokeLegacy = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'draft' });

		await invokeFocused({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract });
		await invokeLegacy({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract });

		// The focused request reaches the harness whole, and a runner created
		// without one leaves the member absent rather than inventing a value —
		// an ordinary spawn must stay byte-identical to what it was before.
		expect(requested).toStrictEqual([
			{
				noMcpServers: true,
				noSkillCatalog: true,
				toolAllowlist: true,
				settingsPreserved: true,
				tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
			},
			undefined,
		]);
	});

	test('each call opens its own step level and hands it to the chokepoint', async () => {
		const workspaceDir = setupWorkspace();
		const answer = JSON.stringify({ ok: true });
		const driver = stubDriver({ answers: [answer, answer] });
		const { level, opened, recordedOn } = setupLevel();
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'grade', level });

		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract });
		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract });

		// One step level per call, not one per runner: two calls really were two
		// requests, and a shared level would report them as one row.
		expect(opened).toStrictEqual([
			{ id: 'command-run/step-1', level: 'step', label: 'grade' },
			{ id: 'command-run/step-2', level: 'step', label: 'grade' },
		]);
		// Each call's harness process lands on that call's own step level, never
		// on the command run above it — which would put every step's spend in one
		// row and lose the step the report exists to name.
		expect(recordedOn).toStrictEqual(['command-run/step-1', 'command-run/step-2']);
	});

	test.each<{ settled: string; driver: () => Driver; outcome: RunStatus }>([
		{ settled: 'answered on contract', driver: () => stubDriver({ answers: [JSON.stringify({ ok: true })] }), outcome: 'passed' },
		// parked rather than failed: the wall is resumable, and a row reading
		// failed would send a human to diagnose a re-run
		{ settled: 'met the rate-limit wall', driver: createRateLimitedDriver, outcome: 'paused-rate-limit' },
	])('closes the step level of a call that $settled as $outcome', async ({ driver, outcome }) => {
		const workspaceDir = setupWorkspace();
		const { level, closed } = setupLevel();
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver: driver(), workspaceDir, step: 'grade', level });

		await invokePlanAgent({ invocation: { systemPrompt: '', prompt: '' }, contract: Contract });

		// the step's own level carries how its call settled, and the command run
		// above it is left open for whatever it opens next
		expect(closed).toStrictEqual([{ id: 'command-run/step-1', outcome }]);
	});

	test('a runner with no level invokes exactly as before and records nothing', async () => {
		const workspaceDir = setupWorkspace();
		const spawned: DriverInvocation[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				spawned.push(invocation);

				return { text: JSON.stringify({ ok: true }), exitCode: 0 };
			},
		};
		const invokePlanAgent = createPlanAgentRunner({ cwd: workspaceDir, driver, workspaceDir, step: 'draft' });

		const { report } = outcomeFields(await invokePlanAgent({ invocation: { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' }, contract: Contract }));

		expect(report).toStrictEqual({ ok: true });
		// One ordinary spawn, carrying nothing an open level would have added to
		// it: a caller with no recorder must reach the harness exactly as it did
		// before the record existed.
		expect(
			spawned.map(({ systemPrompt, prompt, cwd, model, effort, permissions, timeoutMs, allowedCommands, environment }) => ({
				systemPrompt,
				prompt,
				cwd,
				model,
				effort,
				permissions,
				timeoutMs,
				allowedCommands,
				environment,
			})),
		).toStrictEqual([
			{
				systemPrompt: 'ROLE-SYSTEM-PROMPT',
				prompt: 'ROLE-PROMPT',
				cwd: workspaceDir,
				model: undefined,
				effort: undefined,
				permissions: undefined,
				timeoutMs: undefined,
				allowedCommands: undefined,
				environment: undefined,
			},
		]);
		// No level, no record: the plan folder gains no activity file at all.
		expect(readdirSync(workspaceDir)).not.toContain('activity.jsonl');
	});
});
