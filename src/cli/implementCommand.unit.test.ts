import { expect, test } from '@jest/globals';
import { implementCommand } from '@/cli/implementCommand';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

// A real consumer repo whose --plan names a file that does not exist: the
// pipeline fails fast at the plan read, before any harness is spawned, so the
// command's whole render-and-exit path is observable without an agent.
const setupImplement = ({ args }: { args: string[] }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

test('implementCommand: without --plan it prints the usage text on stderr and exits 1 before loading any config', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--skip-refactor'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors.length).toBe(1);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a plan path that does not exist prints the run header, reports the failure on stderr and exits 1', async () => {
	const { context, cwd, logged, errors, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0]).toBe('lightsout: starting run');
	expect(logged[1]).toBe('  plan: ghost.md');
	// the run header names the target repo, got: ${JSON.stringify(logged)}
	expect(logged.some((line) => line === `  cwd: ${cwd}`)).toBeTruthy();
	// the resolved harness rides the header
	expect(logged.some((line) => /^ {2}harness: claude-code · model: harness default/.test(line))).toBeTruthy();
	// the pipeline's failure reaches stderr, got: ${JSON.stringify(errors)}
	expect(errors.some((line) => /plan file not found: .*ghost\.md/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --overview and --packages are echoed on the plan line, the package list trimmed and emptied entries dropped', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--overview', 'overview.md', '--packages', ' api , ,web '] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('  plan: ghost.md\n  overview: overview.md\n  packages flag: api, web');
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: an empty --packages list is no scope at all — the plan line carries no packages segment', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--packages', ' , '] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('  plan: ghost.md\n  packages flag: ');
	expect(exitCodes).toStrictEqual([1]);
});
