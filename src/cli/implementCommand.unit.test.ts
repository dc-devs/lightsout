import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { implementCommand } from '@/cli/implementCommand';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

// A real consumer repo whose --plan names a file that does not exist: the
// pipeline fails fast at the plan read, before any harness is spawned, so the
// command's whole render-and-exit path is observable without an agent.
const setupImplement = ({ t, args }: { t: TestContext; args: string[] }) => {
	const captured = captureCommandOutput({ t });
	const cwd = setupConsumerRepo();

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

test('implementCommand: without --plan it prints the usage text on stderr and exits 1 before loading any config', async (t) => {
	const { context, logged, errors, exitCodes } = setupImplement({ t, args: ['--skip-refactor'] });

	await assert.rejects(implementCommand(context), /process\.exit/);

	assert.deepEqual(logged, []);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});

test('implementCommand: a plan path that does not exist prints the run header, reports the failure on stderr and exits 1', async (t) => {
	const { context, cwd, logged, errors, exitCodes } = setupImplement({ t, args: ['--plan', 'ghost.md'] });

	await assert.rejects(implementCommand(context), /process\.exit/);

	assert.equal(logged[0], 'lightsout: starting run');
	assert.equal(logged[1], '  plan: ghost.md');
	assert.ok(
		logged.some((line) => line === `  cwd: ${cwd}`),
		`the run header names the target repo, got: ${JSON.stringify(logged)}`,
	);
	assert.ok(
		logged.some((line) => /^ {2}harness: claude-code · model: harness default/.test(line)),
		'the resolved harness rides the header',
	);
	assert.ok(
		errors.some((line) => /plan file not found: .*ghost\.md/.test(line)),
		`the pipeline's failure reaches stderr, got: ${JSON.stringify(errors)}`,
	);
	assert.deepEqual(exitCodes, [1]);
});

test('implementCommand: --overview and --packages are echoed on the plan line, the package list trimmed and emptied entries dropped', async (t) => {
	const { context, logged, exitCodes } = setupImplement({ t, args: ['--plan', 'ghost.md', '--overview', 'overview.md', '--packages', ' api , ,web '] });

	await assert.rejects(implementCommand(context), /process\.exit/);

	assert.equal(logged[1], '  plan: ghost.md\n  overview: overview.md\n  packages flag: api, web');
	assert.deepEqual(exitCodes, [1]);
});

test('implementCommand: an empty --packages list is no scope at all — the plan line carries no packages segment', async (t) => {
	const { context, logged, exitCodes } = setupImplement({ t, args: ['--plan', 'ghost.md', '--packages', ' , '] });

	await assert.rejects(implementCommand(context), /process\.exit/);

	assert.equal(logged[1], '  plan: ghost.md\n  packages flag: ');
	assert.deepEqual(exitCodes, [1]);
});
