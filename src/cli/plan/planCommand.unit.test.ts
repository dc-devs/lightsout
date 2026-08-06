import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planCommand } from '@/cli/plan';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { cleanPlanBody } from '@tests/helpers/cleanPlanBody';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { writePlanDeliverable } from '@tests/helpers/writePlanDeliverable';

// planCommand is pure dispatch, so each test drives a route to the point where
// the subcommand it picked is unmistakable in the output — the deterministic
// routes (lint, verify-facts) run to completion, and the agent routes are
// observed at the config resolution they reach before any harness is spawned.
const setupPlan = ({ args, plan, config }: { args: string[]; plan?: string; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	if (plan !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body: plan });
	}

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, cwd, ...captured };
};

test('planCommand: the lint subcommand runs the deterministic lint and exits 0 on a clean plan', async () => {
	const { context, logged, exitCodes } = setupPlan({ args: ['lint', '--name', 'demo'], plan: cleanPlanBody() });

	await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('\nplan lint demo — clean (1 file(s))');
	expect(exitCodes).toStrictEqual([0]);
});

test('planCommand: the verify-facts subcommand routes to the deterministic verifier — no config, no driver, no agent', async () => {
	const { context, errors, exitCodes } = setupPlan({ args: ['verify-facts', '--name', 'demo'] });

	await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/no authored facts for plan demo/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planCommand: the draft subcommand resolves config and driver after the required --name — a broken config stops it there', async () => {
	const { context } = setupPlan({
		
		args: ['draft', '--name', 'demo'],
		config: { driver: 'codex', scripts: { check: 'true', testUnit: 'true', testCoverage: false } },
	});

	await expect(planCommand(context)).rejects.toThrow(/renamed to `harness`/);
});

test('planCommand: an agent subcommand without --name prints the usage text and exits 1 before any config is read', async () => {
	const { context, errors, exitCodes } = setupPlan({
		
		args: ['draft'],
		config: { driver: 'codex', scripts: { check: 'true', testUnit: 'true', testCoverage: false } },
	});

	await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planCommand: an unknown subcommand prints the usage text on stderr and exits 1', async () => {
	const { context, logged, errors, exitCodes } = setupPlan({ args: ['explore', '--name', 'demo'] });

	await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planCommand: no subcommand at all prints the usage text on stderr and exits 1', async () => {
	const { context, errors, exitCodes } = setupPlan({ args: ['--name', 'demo'] });

	await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});
