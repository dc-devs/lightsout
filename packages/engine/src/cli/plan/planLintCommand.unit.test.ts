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

	expect(logged[0] ?? '').toMatch(/^\[\+\d+:\d\d\] plan lint demo: 0 blocking, 0 advisory finding\(s\) across 1 file\(s\)$/);
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

	expect(logged[1]).toBe('\nplan lint demo — 1 blocking finding(s) (1 file(s))');
	expect(logged[2] ?? '').toMatch(/^⚠ plan\.md \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
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

/**
 * A clean plan grown past the touched-file limit by 55 earlier-phase modifies —
 * paths a predecessor writes, so absent from disk and never a path-exists defect.
 * One create plus those 55 is 56 touched source files (`src/index.js` is a barrel
 * and counts toward neither), well under the 30-file created ceiling.
 */
const mechanicalPlanBody = () => {
	const entries = Array.from({ length: 55 }, (_, index) => `### \`src/renamed${index}.ts\`\n\nRename one import.\n`).join('\n');

	return `${cleanPlanBody()}\n## Files to Modify from Earlier Phases\n\n${entries}\n`;
};

test('planLintCommand: a touched-file advisory prints as a note beside a clean headline and leaves the exit code at 0', async () => {
	const { context, logged, errors, exitCodes } = setupLint({ body: mechanicalPlanBody(), args: ['--name', 'demo'] });

	await expect(planLintCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0] ?? '').toMatch(/^\[\+\d+:\d\d\] plan lint demo: 0 blocking, 1 advisory finding\(s\) across 1 file\(s\)$/);
	expect(logged[1]).toBe('\nplan lint demo — clean, 1 advisory finding(s) (1 file(s))');
	expect(logged[2] ?? '').toMatch(/^note plan\.md \[scope-within-guardrail\] plan\.md — plan touches 56 source files, over the 50-file limit/);
	expect(logged[3] ?? '').toMatch(/^ {3}fix: legal, but the implementing agent stops at 50 files/);
	expect(errors).toStrictEqual([]);
	// an advisory informs; only a blocking finding moves the signal the self-lint
	// loop reads
	expect(exitCodes).toStrictEqual([0]);
});
