import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { sourceEvidencePath } from '#src/plan/evidence/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A seeded plan workspace whose driver answers to `omp` — the one registered
 * harness that declares every control the drafting environment asks for except
 * the MCP exclusion, so a draft against it is refused for exactly one named
 * reason.
 *
 * The driver itself is an ordinary working author: if the preflight ever lets a
 * run through, the failure is the missing refusal rather than a stub that could
 * not write.
 */
const setupIncapableHarness = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		...createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) }),
		name: 'omp',
	};

	return { cwd, driver, invocations, planDir: join(cwd, '.lightsout', 'plans', name) };
};

describe('runPlanDraft', () => {
	test('refuses before any spawn when the harness cannot provide a requested control', async () => {
		const { cwd, driver, invocations, planDir } = setupIncapableHarness({ name: 'no-mcp-control' });

		const result = await runPlanDraft({ cwd, driver, name: 'no-mcp-control' });

		expectStatus(result, 'failed');
		// the refusal names the control this harness cannot express
		expect(result.error).toMatch(/mcp/i);
		// nothing was spawned — the whole point is refusing before the spend
		expect(invocations).toStrictEqual([]);
		// and nothing was read for evidence either, which walks and reads the repo
		expect(existsSync(sourceEvidencePath({ cwd, name: 'no-mcp-control' }))).toBeFalsy();
		// the run never reached a draft flow, so no deliverable was written
		expect(existsSync(join(planDir, 'plan.md'))).toBeFalsy();
	});

	test('offers no way past the refusal, because there is no second authoring implementation', async () => {
		const { cwd, driver, invocations, planDir } = setupIncapableHarness({ name: 'no-escape' });

		const result = await runPlanDraft({ cwd, driver, name: 'no-escape' });

		expectStatus(result, 'failed');
		// the same harness is refused on every draft of this folder: there is no
		// flag, no mode and no implementation that reaches an unrestricted writer
		expect(result.error).not.toMatch(/--legacy/);
		expect(result.implementation).toBe('focused');
		expect(invocations).toStrictEqual([]);
		expect(existsSync(join(planDir, 'plan.md'))).toBeFalsy();
	});
});
