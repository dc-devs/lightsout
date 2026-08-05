import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Driver } from '@/drivers';
import { planDedupCommand } from '@/cli/plan/planDedupCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

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

// A temp repo holding the given existing source files and a plan that creates
// the given paths — the same arrangement the deterministic prior-art detector
// is exercised with, so the collisions the judge rules on are real ones.
const setupDedup = ({ t, existing = [], creates = [], plan = true }: { t: TestContext; existing?: string[]; creates?: string[]; plan?: boolean }) => {
	const captured = captureCommandOutput({ t });
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-command-'));
	const plansDir = join(cwd, '.claude', 'plans');

	for (const relative of existing) {
		mkdirSync(dirname(join(cwd, relative)), { recursive: true });
		writeFileSync(join(cwd, relative), 'export const x = 1;\n');
	}

	mkdirSync(plansDir, { recursive: true });

	if (plan) {
		writeFileSync(join(plansDir, 'demo.md'), `# Plan\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`);
	}

	return { cwd, plansDir, name: 'demo', ...captured };
};

test('planDedupCommand: a plan with no colliding symbols reports no duplication, never calls the judge, and exits 0', async (t) => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupDedup({ t, existing: ['src/index.ts'], creates: ['src/brandNewWidget.ts'] });
	const calls = { count: 0 };

	await assert.rejects(
		planDedupCommand({ cwd, driver: judgeDriver({ verdicts: [], calls }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.equal(calls.count, 0, 'no candidates means no agent call');
	assert.match(printed[0] ?? '', /^\nplan dedup demo — no duplication found \(reviewed \d{4}-\d\d-\d\dT/);
	assert.equal(printed[1], `\ndedup: ${join(cwd, '.lightsout', 'plans', 'demo', 'dedup.json')}`);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('planDedupCommand: a confirmed duplicate prints its recommendation, what it collides with, its rationale, and exits 0', async (t) => {
	const { cwd, plansDir, name, logged, exitCodes } = setupDedup({ t, existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' }];

	await assert.rejects(
		planDedupCommand({ cwd, driver: judgeDriver({ verdicts, calls }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.equal(calls.count, 1, 'the judge ruled on the detected candidate');
	assert.match(printed[0] ?? '', /^\nplan dedup demo — 1 duplication\(s\) to review \(reviewed \d{4}-\d\d-\d\dT/);
	assert.match(printed[1] ?? '', /^⧉ getUser \[reuse\] collides with \S*fetchUser\.ts$/);
	assert.equal(printed[2], '   fetchUser already does this');
	assert.equal(printed[3], `\ndedup: ${join(cwd, '.lightsout', 'plans', 'demo', 'dedup.json')}`);
	assert.deepEqual(exitCodes, [0]);
});

test('planDedupCommand: a verdict that rules the collision distinct leaves no finding to review', async (t) => {
	const { cwd, plansDir, name, logged, exitCodes } = setupDedup({ t, existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' }];

	await assert.rejects(
		planDedupCommand({ cwd, driver: judgeDriver({ verdicts, calls }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.equal(calls.count, 1);
	assert.match(printed[0] ?? '', /^\nplan dedup demo — no duplication found/);
	assert.equal(printed.length, 2, `a dropped verdict prints no finding line, got: ${JSON.stringify(printed)}`);
	assert.deepEqual(exitCodes, [0]);
});

test('planDedupCommand: an unresolvable deliverable reports the error on stderr and exits 1', async (t) => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupDedup({ t, plan: false });
	const calls = { count: 0 };

	await assert.rejects(
		planDedupCommand({ cwd, driver: judgeDriver({ verdicts: [], calls }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	assert.deepEqual(printedLines({ logged }), []);
	assert.match(errors[0] ?? '', /no plan found for 'demo'/);
	assert.deepEqual(exitCodes, [1]);
});
