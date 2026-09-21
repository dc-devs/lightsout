import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readFriction } from '#src/runState/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** A well-formed persisted record: the entry plus its provenance. */
const record = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		kind: 'friction',
		area: 'plan',
		detail: 'the plan was silent on the boundary',
		at: '2026-07-03T00:00:00.000Z',
		runId: 'run-a',
		step: 'implement',
		...overrides,
	});

interface SetupParams {
	/** Raw lines written to friction.jsonl verbatim — malformed ones included. */
	lines?: string[];
}

const setupFrictionLog = ({ lines }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const logPath = join(cwd, '.lightsout', 'friction.jsonl');

	if (lines) {
		mkdirSync(dirname(logPath), { recursive: true });
		writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
	}

	return { cwd, logPath };
};

interface LinkedWorktreeSetupParams {
	/** Raw lines an earlier run appended to the primary checkout's ledger. */
	lines: string[];
}

/**
 * A primary checkout holding the ledger, with a linked worktree cut from it and
 * no state directory of its own — the shape an isolated run reads from.
 */
const setupLinkedWorktreeLog = ({ lines }: LinkedWorktreeSetupParams) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-7-isolate');

	execSync(`git worktree add -q -b feature/lo-7-isolate "${worktree}" main`, { cwd, stdio: 'ignore' });

	const logPath = join(cwd, '.lightsout', 'friction.jsonl');

	mkdirSync(dirname(logPath), { recursive: true });
	writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

	return { primary: cwd, worktree };
};

describe('readFriction', () => {
	test('reads every accumulated record with its provenance, in the order logged', async () => {
		const { cwd } = setupFrictionLog({
			lines: [record(), record({ kind: 'decision', area: 'standards', detail: 'chose the newer rule', runId: 'run-b', step: 'refactor' })],
		});

		const friction = await readFriction({ cwd });

		expect(friction).toStrictEqual([
			{ kind: 'friction', area: 'plan', detail: 'the plan was silent on the boundary', at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' },
			{ kind: 'decision', area: 'standards', detail: 'chose the newer rule', at: '2026-07-03T00:00:00.000Z', runId: 'run-b', step: 'refactor' },
		]);
	});

	test('reads empty for a repo that has logged no friction at all', async () => {
		const { cwd } = setupFrictionLog();

		const friction = await readFriction({ cwd });

		// a missing log is an empty history, not a failure
		expect(friction).toStrictEqual([]);
	});

	test('skips a line that is not JSON and keeps the records around it', async () => {
		const { cwd } = setupFrictionLog({
			lines: [record({ detail: 'first' }), 'not json at all', record({ detail: 'third' })],
		});

		const friction = await readFriction({ cwd });

		expect(friction.map((entry) => entry.detail)).toStrictEqual(['first', 'third']);
	});

	test('skips a line that fails the record contract rather than guessing its provenance', async () => {
		const { cwd } = setupFrictionLog({
			lines: [
				JSON.stringify({ area: 'plan', detail: 'no provenance on this one' }),
				record({ detail: 'complete record' }),
				JSON.stringify({ area: 'plan', detail: 42, at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' }),
			],
		});

		const friction = await readFriction({ cwd });

		expect(friction.map((entry) => entry.detail)).toStrictEqual(['complete record']);
	});

	test('ignores blank lines left by an interrupted append', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ detail: 'first' }), '', record({ detail: 'second' }), ''] });

		const friction = await readFriction({ cwd });

		expect(friction.length).toBe(2);
	});

	test('keeps a record whose area the taxonomy does not recognise, coercing it to other', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ area: 'scope', detail: 'invented an area' })] });

		const friction = await readFriction({ cwd });

		expect(friction).toStrictEqual([
			{ kind: 'friction', area: 'other', detail: 'invented an area', at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' },
		]);
	});

	test("readFriction: reads the primary checkout's ledger from a linked worktree", async () => {
		const { worktree } = setupLinkedWorktreeLog({
			lines: [record({ detail: 'logged from the primary', runId: 'run-primary' })],
		});

		const friction = await readFriction({ cwd: worktree });

		// the worktree keeps no ledger of its own, so a per-checkout read would be empty
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(friction).toStrictEqual([
			{ kind: 'friction', area: 'plan', detail: 'logged from the primary', at: '2026-07-03T00:00:00.000Z', runId: 'run-primary', step: 'implement' },
		]);
	});

	test('reads the repo-wide log, not a single run directory', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ runId: 'run-a' }), record({ runId: 'run-b' })] });

		const friction = await readFriction({ cwd });

		// friction accumulates across runs so the improvement loop sees patterns
		expect(friction.map((entry) => entry.runId)).toStrictEqual(['run-a', 'run-b']);
	});
});
