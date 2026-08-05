import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
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
const setupPlan = ({ t, args, plan, config }: { t: TestContext; args: string[]; plan?: string; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput({ t });
	const cwd = setupConsumerRepo({ git: false });

	if (plan !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body: plan });
	}

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, cwd, ...captured };
};

test('planCommand: the lint subcommand runs the deterministic lint and exits 0 on a clean plan', async (t) => {
	const { context, logged, exitCodes } = setupPlan({ t, args: ['lint', '--name', 'demo'], plan: cleanPlanBody() });

	await assert.rejects(planCommand(context), /process\.exit/);

	assert.equal(logged[1], '\nplan lint demo — clean (1 file(s))');
	assert.deepEqual(exitCodes, [0]);
});

test('planCommand: the verify-facts subcommand routes to the deterministic verifier — no config, no driver, no agent', async (t) => {
	const { context, errors, exitCodes } = setupPlan({ t, args: ['verify-facts', '--name', 'demo'] });

	await assert.rejects(planCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /no authored facts for plan demo/);
	assert.deepEqual(exitCodes, [1]);
});

test('planCommand: the draft subcommand resolves config and driver after the required --name — a broken config stops it there', async (t) => {
	const { context } = setupPlan({
		t,
		args: ['draft', '--name', 'demo'],
		config: { driver: 'codex', scripts: { check: 'true', testUnit: 'true', testCoverage: false } },
	});

	await assert.rejects(planCommand(context), /renamed to `harness`/);
});

test('planCommand: an agent subcommand without --name prints the usage text and exits 1 before any config is read', async (t) => {
	const { context, errors, exitCodes } = setupPlan({
		t,
		args: ['draft'],
		config: { driver: 'codex', scripts: { check: 'true', testUnit: 'true', testCoverage: false } },
	});

	await assert.rejects(planCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});

test('planCommand: an unknown subcommand prints the usage text on stderr and exits 1', async (t) => {
	const { context, logged, errors, exitCodes } = setupPlan({ t, args: ['explore', '--name', 'demo'] });

	await assert.rejects(planCommand(context), /process\.exit/);

	assert.deepEqual(logged, []);
	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});

test('planCommand: no subcommand at all prints the usage text on stderr and exits 1', async (t) => {
	const { context, errors, exitCodes } = setupPlan({ t, args: ['--name', 'demo'] });

	await assert.rejects(planCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});
