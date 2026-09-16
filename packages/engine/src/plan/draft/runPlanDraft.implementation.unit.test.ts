import { describe, expect, test } from '@jest/globals';
import { getUnknownFlagsMessage, parseFlags } from '#src/cli/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A seeded repo whose driver answers to `claude-code`, the one harness name the
 * capability registry credits with every control the drafting environment asks
 * for. The stub's own name would fail the preflight before anything ran.
 *
 * What the writer was spawned with is read off the driver invocation, which is
 * the only place the environment request is observable.
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
	test('drafts in the restricted writer environment, which is the only implementation there is', async () => {
		const { cwd, driver, invocations } = setupDraft();

		const result = await runPlanDraft({ cwd, driver, name: 'implementation' });

		expectStatus(result, 'complete');
		// the draft says what produced it, so the plan folder stays attributable
		expect(result.implementation).toBe('focused');
		// and the writer it spawned asked for the restricted environment on every
		// spawn: no caller can ask for one that does not
		expect(invocations).not.toStrictEqual([]);
		expect(invocations.map((invocation) => invocation.environment)).toStrictEqual(
			invocations.map(() => expect.objectContaining({ noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true })),
		);
	});

	test('rejects --legacy rather than selecting a second authoring engine with it', () => {
		// The flag is unknown to the parser, so `--help` and the dispatcher agree
		// there is no second engine to select. The command's own refusal — resolving
		// nothing and spawning nothing — is pinned beside its subject, in
		// planDraftCommand.legacy.unit.test.ts.
		expect(getUnknownFlagsMessage({ command: 'plan', flags: parseFlags({ args: ['--legacy'] }) })).toMatch(/--legacy/);
	});
});
