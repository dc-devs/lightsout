import { describe, expect, test } from '@jest/globals';
import { DraftImplementation } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A seeded repo whose driver answers to `claude-code`, the one harness name the
 * capability registry credits with every control the focused environment asks
 * for. The stub's own name would fail the preflight before either flow ran, so
 * neither implementation could be told from the other.
 *
 * Which flow spawned is read off the driver invocation: a focused writer is
 * spawned with the requested environment, and a legacy writer with none at all.
 */
const setupDraft = () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'implementation' });

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		...createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) }),
		name: 'claude-code',
	};

	return { cwd, driver, invocations };
};

describe('runPlanDraft', () => {
	test('drafts with the focused implementation when none is named', async () => {
		const { cwd, driver, invocations } = setupDraft();

		const result = await runPlanDraft({ cwd, driver, name: 'implementation' });

		expectStatus(result, 'complete');
		// the draft says what produced it, so the plan folder stays attributable
		expect(result.implementation).toBe('focused');
		// and the writer it spawned asked for the focused environment, which is
		// what a legacy spawn never carries
		expect(invocations[0]?.environment).toEqual(
			expect.objectContaining({ noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true }),
		);
	});

	test('drafts with the legacy implementation when it is named', async () => {
		const { cwd, driver, invocations } = setupDraft();

		const result = await runPlanDraft({ cwd, driver, name: 'implementation', implementation: DraftImplementation.Legacy });

		expectStatus(result, 'complete');
		// the named implementation rides the result rather than the default
		expect(result.implementation).toBe('legacy');
		// one legacy spawn, requesting no environment: its invocation is exactly
		// what it was before the focused flow existed
		expect(invocations.map((invocation) => invocation.environment)).toStrictEqual([undefined]);
	});
});
