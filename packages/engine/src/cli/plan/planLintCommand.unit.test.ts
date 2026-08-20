import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planLintCommand } from '#src/cli/plan/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// plan lint is deterministic — no agent, no driver — so the arrangement is a
// real consumer repo with a real committed deliverable, linted through the same
// pass the CLI runs.
const setupLint = ({ body, args, name = 'demo' }: { body?: string; args: string[]; name?: string }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name, body });
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

test('planLintCommand: a clean plan reports clean with its file count and exits 0', async () => {
	const { context, logged, errors, exitCodes } = setupLint({ body: cleanPlanBody(), args: ['--name', 'demo'] });

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0] ?? '').toMatch(/^\[\+\d+:\d\d\] plan lint demo: 0 structural finding\(s\) across 1 file\(s\)$/);
	expect(logged[1]).toBe('\nplan lint demo — clean (1 file(s))');
	// a clean plan prints no finding lines, got: ${JSON.stringify(logged)}
	expect(logged.length).toBe(2);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planLintCommand: a placeholder in the plan prints the finding with its fix and exits 1 — the signal the self-lint loop reads', async () => {
	const { context, logged, exitCodes } = setupLint({
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
		args: ['--name', 'demo'],
	});

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('\nplan lint demo — 1 structural finding(s) (1 file(s))');
	expect(logged[2] ?? '').toMatch(/^⚠ \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(logged[3] ?? '').toMatch(/^ {3}fix: resolve 'TBD'/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planLintCommand: a --plans directory no longer redirects anything — the plan is read from the one folder under .lightsout/plans', async () => {
	const { context, logged, exitCodes } = setupLint({ body: cleanPlanBody(), args: ['--name', 'demo', '--plans', 'elsewhere'] });

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('\nplan lint demo — clean (1 file(s))');
	expect(exitCodes).toStrictEqual([0]);
});

test('planLintCommand: no deliverable for the name reports the resolution error on stderr and exits 1', async () => {
	const { context, logged, errors, exitCodes } = setupLint({ args: ['--name', 'ghost'] });

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/no plan found for 'ghost'/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planLintCommand: without --name it prints the usage text on stderr and exits 1 before resolving anything', async () => {
	const { context, errors, exitCodes } = setupLint({ args: [] });

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});
