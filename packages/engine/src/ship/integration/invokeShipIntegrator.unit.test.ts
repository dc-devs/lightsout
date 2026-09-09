import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { invokeShipIntegrator } from '#src/ship/integration/invokeShipIntegrator.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { report } from '#tests/helpers/report.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';

/** A directory to spawn against — this step reads no git state, so an empty one is the whole requirement. */
const spawnCwd = () => mkdtempSync(join(tmpdir(), 'lightsout-integrator-'));

/**
 * One spawn against a harness scripted to answer a single fixed final message,
 * so the report's own status is the only thing deciding the answer.
 */
const setupIntegrator = ({ text }: { text: string }) => {
	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text, exitCode: 0 };
		},
	};

	return { cwd: spawnCwd(), invocations, integration: shipIntegrationFixture({ driver }) };
};

/** One spawn against a harness that answers every invocation with its subscription wall. */
const setupRateLimitedIntegrator = () => {
	const invocations: DriverInvocation[] = [];

	return { cwd: spawnCwd(), invocations, integration: shipIntegrationFixture({ driver: createRateLimitedDriver({ invocations }) }) };
};

describe('invokeShipIntegrator', () => {
	test('reports a refused work report as a reason and a complete one as success', async () => {
		const complete = setupIntegrator({ text: report({ status: 'complete', summary: 'resolved both sides' }) });
		const refused = setupIntegrator({
			text: report({
				status: 'terminated:scope',
				summary: 'the merge is bigger than this role',
				failures: ['the conflict spans work this branch never touched', 'a second line no caller should be handed'],
			}),
		});

		const settled = await invokeShipIntegrator({
			cwd: complete.cwd,
			integration: complete.integration,
			branch: 'lo-89-ship',
			defaultBranch: 'main',
			conflictPaths: ['src/app.ts'],
		});
		const reason = await invokeShipIntegrator({
			cwd: refused.cwd,
			integration: refused.integration,
			branch: 'lo-89-ship',
			defaultBranch: 'main',
			conflictPaths: ['src/app.ts'],
		});

		// a completed report is the only thing that reads as success
		expect(settled).toBeUndefined();
		// anything else is a spent attempt carrying the agent's own first line —
		// one line, so a caller bounding attempts is not handed a wall of text
		expect(reason).toEqual(expect.stringContaining('the conflict spans work this branch never touched'));
		expect(reason).not.toEqual(expect.stringContaining('a second line no caller should be handed'));
	});

	test('turns a rate-limited harness into a reason the caller can bound', async () => {
		const { cwd, integration, invocations } = setupRateLimitedIntegrator();

		const reason = await invokeShipIntegrator({
			cwd,
			integration,
			branch: 'lo-89-ship',
			defaultBranch: 'main',
			errorContext: 'gate output the repair attempt was handed',
		});

		// a harness that will not answer costs the same bounded attempt a wrong
		// answer costs, instead of escaping the loop as an exception
		expect(reason).toMatch(/rate limit/i);
		expect(invocations.length).toBe(1);
	});
});
