import { describe, expect, test } from '@jest/globals';
import { PlanVariant } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// What a human watching an unattended draft actually sees, and the timeout
// ceiling the spawns behind it are held to.

/** The clean skeleton with a planted placeholder, so the structural lint forces one repair round. */
const dirtyPlan = () => cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

/**
 * A seeded plan workspace whose facts touch `count` paths — the input the
 * variant estimate reads — plus the collectors the act writes into.
 */
const setupDraft = ({ name, count = 0 }: { name: string; count?: number }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({
		cwd,
		name,
		areas: [
			{
				area: 'core',
				filesToModify: Array.from({ length: count }, (_, index) => ({ path: `src/mod${index}.ts`, role: 'touched' })),
				patternsToMirror: [],
				namingConvention: 'camelCase',
			},
		],
	});

	const messages: string[] = [];
	const invocations: DriverInvocation[] = [];

	return { cwd, name, messages, invocations, onProgress: (message: string) => messages.push(message) };
};

describe('runPlanDraft', () => {
	test('a clean run narrates the estimated variant and the file count it converged on', async () => {
		const { cwd, name, messages, onProgress } = setupDraft({ name: 'narrated' });

		const result = await runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [cleanPlanBody()] }), name, onProgress });

		expectStatus(result, 'complete');
		// the whole unattended run is legible from the narration alone, in order,
		// got: ${messages.join(' | ')}
		expect(messages).toEqual([
			expect.stringMatching(/no brainstorm decisions/),
			expect.stringMatching(/variant single \(estimated\)/),
			expect.stringMatching(/structurally clean \(1 file\(s\)\)/),
		]);
	});

	test('an explicit scope flag is narrated as the flag, not as an estimate', async () => {
		// 41 touched paths would estimate `overview`; the flag overrides it, and
		// the narration has to say which of the two decided.
		const { cwd, name, messages, onProgress } = setupDraft({ name: 'flagged', count: 41 });

		const result = await runPlanDraft({
			cwd,
			driver: createDraftDriver({ bodies: [cleanPlanBody()] }),
			name,
			scope: PlanVariant.Single,
			onProgress,
		});

		expectStatus(result, 'complete');
		expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/variant single \(scope flag\)/)]));
		// an estimate never claims credit for a flagged variant
		expect(messages.some((message) => message.includes('estimated'))).toBe(false);
	});

	test('the repair rounds narrate through the same progress channel as the draft', async () => {
		const { cwd, name, messages, onProgress } = setupDraft({ name: 'repaired' });

		const result = await runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()] }), name, onProgress });

		expectStatus(result, 'complete');
		// the repair loop is not a silent sub-step — its rounds reach the same watcher
		expect(messages).toEqual(
			expect.arrayContaining([expect.stringMatching(/1 structural finding\(s\).*repair 1\/3/), expect.stringMatching(/structurally clean/)]),
		);
	});

	test('an explicit timeoutMs bounds the writer and every repair spawn alike', async () => {
		const { cwd, name, invocations } = setupDraft({ name: 'bounded' });
		const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });

		const result = await runPlanDraft({ cwd, driver, name, timeoutMs: 90_000 });

		expectStatus(result, 'complete');
		// the repair spawn inherits the caller's ceiling rather than falling back
		// to this role's own — a hung repairer costs exactly what a hung writer does
		expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([90_000, 90_000]);
	});

	test('an omitted timeoutMs falls back to the thirty-minute ceiling', async () => {
		const { cwd, name, invocations } = setupDraft({ name: 'defaulted' });
		const driver = createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });

		const result = await runPlanDraft({ cwd, driver, name });

		expectStatus(result, 'complete');
		// a writer spawn is never left to run forever just because no ceiling was given
		expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([30 * 60 * 1000]);
	});
});
