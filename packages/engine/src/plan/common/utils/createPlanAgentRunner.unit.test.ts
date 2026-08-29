import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { z } from 'zod';
import type { Driver } from '#src/drivers/index.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
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
});
