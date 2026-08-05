import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planLintCommand } from '@/cli/plan/planLintCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { cleanPlanBody } from '@tests/helpers/cleanPlanBody';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { writePlanDeliverable } from '@tests/helpers/writePlanDeliverable';

// plan lint is deterministic — no agent, no driver — so the arrangement is a
// real consumer repo with a real committed deliverable, linted through the same
// pass the CLI runs.
const setupLint = ({
	t,
	body,
	args,
	name = 'demo',
	plansSubdir,
}: {
	t: TestContext;
	body?: string;
	args: string[];
	name?: string;
	plansSubdir?: string;
}) => {
	const captured = captureCommandOutput({ t });
	const cwd = setupConsumerRepo({ git: false });
	const plansDir = plansSubdir === undefined ? undefined : join(cwd, plansSubdir);

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name, body, ...(plansDir === undefined ? {} : { plansDir }) });
	}

	const flags = parseFlags({ args: plansDir === undefined ? args : [...args, '--plans', plansDir] });

	return { context: { flags, rest: [], cwd }, cwd, ...captured };
};

test('planLintCommand: a clean plan reports clean with its file count and exits 0', async (t) => {
	const { context, logged, errors, exitCodes } = setupLint({ t, body: cleanPlanBody(), args: ['--name', 'demo'] });

	await assert.rejects(planLintCommand(context), /process\.exit/);

	assert.match(logged[0] ?? '', /^\[\+\d+:\d\d\] plan lint demo: 0 structural finding\(s\) across 1 file\(s\)$/);
	assert.equal(logged[1], '\nplan lint demo — clean (1 file(s))');
	assert.equal(logged.length, 2, `a clean plan prints no finding lines, got: ${JSON.stringify(logged)}`);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('planLintCommand: a placeholder in the plan prints the finding with its fix and exits 1 — the signal the self-lint loop reads', async (t) => {
	const { context, logged, exitCodes } = setupLint({
		t,
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
		args: ['--name', 'demo'],
	});

	await assert.rejects(planLintCommand(context), /process\.exit/);

	assert.equal(logged[1], '\nplan lint demo — 1 structural finding(s) (1 file(s))');
	assert.match(logged[2] ?? '', /^⚠ \[no-placeholders\] demo\.md:\d+ — unresolved placeholder 'TBD' present$/);
	assert.match(logged[3] ?? '', /^ {3}fix: resolve 'TBD'/);
	assert.deepEqual(exitCodes, [1]);
});

test('planLintCommand: an explicit --plans directory is where the deliverable is read from', async (t) => {
	const { context, logged, exitCodes } = setupLint({ t, body: cleanPlanBody(), args: ['--name', 'demo'], plansSubdir: 'elsewhere' });

	await assert.rejects(planLintCommand(context), /process\.exit/);

	assert.equal(logged[1], '\nplan lint demo — clean (1 file(s))');
	assert.deepEqual(exitCodes, [0]);
});

test('planLintCommand: no deliverable for the name reports the resolution error on stderr and exits 1', async (t) => {
	const { context, logged, errors, exitCodes } = setupLint({ t, args: ['--name', 'ghost'] });

	await assert.rejects(planLintCommand(context), /process\.exit/);

	assert.deepEqual(logged, []);
	assert.match(errors[0] ?? '', /no plan found for 'ghost'/);
	assert.deepEqual(exitCodes, [1]);
});

test('planLintCommand: without --name it prints the usage text on stderr and exits 1 before resolving anything', async (t) => {
	const { context, errors, exitCodes } = setupLint({ t, args: [] });

	await assert.rejects(planLintCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});
