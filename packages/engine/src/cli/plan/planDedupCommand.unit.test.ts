import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { planDedupCommand } from '@/cli/plan';
import type { Driver } from '@/drivers';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** A dedup-judge stub returning a fixed verdict set and counting the invocations it was actually handed. */
const judgeDriver = ({ verdicts, calls }: { verdicts: unknown[]; calls: { count: number } }): Driver => ({
	name: 'stub',
	invoke: async () => {
		calls.count += 1;

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

/** A judge stub whose harness reports it hit its subscription rate limit. */
const rateLimitedDriver = (): Driver => ({
	name: 'stub',
	invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }),
});

// A temp repo holding the given existing source files and a plan that creates
// the given paths — the same arrangement the deterministic prior-art detector
// is exercised with, so the collisions the judge rules on are real ones.
const setupDedup = ({ existing = [], creates = [], plan = true }: { existing?: string[]; creates?: string[]; plan?: boolean } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-command-'));
	const planDir = join(cwd, '.lightsout', 'plans', 'demo');

	for (const relative of existing) {
		mkdirSync(dirname(join(cwd, relative)), { recursive: true });
		writeFileSync(join(cwd, relative), 'export const x = 1;\n');
	}

	mkdirSync(planDir, { recursive: true });

	if (plan) {
		writeFileSync(join(planDir, 'plan.md'), `# Plan\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`);
	}

	return { cwd, name: 'demo', ...captured };
};

test('planDedupCommand: a plan with no colliding symbols reports no duplication, never calls the judge, and exits 0', async () => {
	const { cwd, name, logged, errors, exitCodes } = setupDedup({ existing: ['src/index.ts'], creates: ['src/brandNewWidget.ts'] });
	const calls = { count: 0 };

	await expect(planDedupCommand({ cwd, driver: judgeDriver({ verdicts: [], calls }), name, standards: undefined, config: undefined })).rejects.toThrow(
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	// no candidates means no agent call
	expect(calls.count).toBe(0);
	expect(printed[0] ?? '').toMatch(/^\nplan dedup demo — no duplication found \(reviewed \d{4}-\d\d-\d\dT/);
	expect(printed[1]).toBe(`\ndedup: ${join(cwd, '.lightsout', 'plans', 'demo', 'dedup.json')}`);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDedupCommand: a confirmed duplicate prints its recommendation, what it collides with, its rationale, and exits 0', async () => {
	const { cwd, name, logged, exitCodes } = setupDedup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' }];

	await expect(planDedupCommand({ cwd, driver: judgeDriver({ verdicts, calls }), name, standards: undefined, config: undefined })).rejects.toThrow(
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	// the judge ruled on the detected candidate
	expect(calls.count).toBe(1);
	expect(printed[0] ?? '').toMatch(/^\nplan dedup demo — 1 duplication\(s\) to review \(reviewed \d{4}-\d\d-\d\dT/);
	expect(printed[1] ?? '').toMatch(/^⧉ getUser \[reuse\] collides with \S*fetchUser\.ts$/);
	expect(printed[2]).toBe('   fetchUser already does this');
	expect(printed[3]).toBe(`\ndedup: ${join(cwd, '.lightsout', 'plans', 'demo', 'dedup.json')}`);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDedupCommand: a verdict that rules the collision distinct leaves no finding to review', async () => {
	const { cwd, name, logged, exitCodes } = setupDedup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' }];

	await expect(planDedupCommand({ cwd, driver: judgeDriver({ verdicts, calls }), name, standards: undefined, config: undefined })).rejects.toThrow(
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	expect(calls.count).toBe(1);
	expect(printed[0] ?? '').toMatch(/^\nplan dedup demo — no duplication found/);
	// a dropped verdict prints no finding line, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(2);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDedupCommand: an unresolvable deliverable reports the error on stderr and exits 1', async () => {
	const { cwd, name, logged, errors, exitCodes } = setupDedup({ plan: false });
	const calls = { count: 0 };

	await expect(planDedupCommand({ cwd, driver: judgeDriver({ verdicts: [], calls }), name, standards: undefined, config: undefined })).rejects.toThrow(
		/process\.exit/,
	);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/no plan found for 'demo'/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planDedupCommand: a rate-limited harness prints the exact re-run command and exits 1 rather than reporting an empty review', async () => {
	const { cwd, name, logged, errors, exitCodes } = setupDedup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });

	await expect(planDedupCommand({ cwd, driver: rateLimitedDriver(), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/rate limited or overloaded — re-run: lightsout plan dedup --name demo$/);
	expect(exitCodes).toStrictEqual([1]);
});
