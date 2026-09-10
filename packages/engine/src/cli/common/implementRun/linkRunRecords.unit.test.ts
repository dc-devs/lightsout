import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { linkRunRecords } from '#src/cli/common/implementRun/linkRunRecords.ts';
import { ShipResult, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { appendFriction, appendReviewFindings, readFriction, readReviewFindings } from '#src/runState/index.ts';
import { getShipResultPath, readShipResult } from '#src/ship/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const runId = 'run-isolated';
const branch = 'lo-9-isolated-run';

const finding: StandardsFinding = {
	rule: 'single-return',
	severity: StandardsSeverity.Advisory,
	siteKey: 'single-return:src/a.ts',
	files: [{ path: 'src/a.ts', startLine: 12 }],
	detail: 'six exits',
};

interface SetupParams {
	/** A real runs directory of the workspace's own, standing where the link belongs. */
	workspaceRunsDir?: boolean;
	/** A friction record an earlier run already logged in the launching checkout. */
	priorFriction?: Record<string, unknown>;
	/** Link the records before the test acts. The cases whose act IS the link pass false. */
	link?: boolean;
}

/** A launching checkout and a separate worktree, with the run records linked between them. */
const setupLinkedWorkspace = async ({ workspaceRunsDir = false, priorFriction, link = true }: SetupParams = {}) => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();

	if (workspaceRunsDir) {
		await mkdir(join(workspace, '.lightsout', 'runs'), { recursive: true });
	}

	if (priorFriction !== undefined) {
		await mkdir(join(sourceCwd, '.lightsout'), { recursive: true });
		await writeFile(join(sourceCwd, '.lightsout', 'friction.jsonl'), `${JSON.stringify(priorFriction)}\n`, 'utf8');
	}

	if (link) {
		await linkRunRecords({ sourceCwd, workspace });
	}

	return { sourceCwd, workspace };
};

/** The two append-only ledgers one run writes, appended at whichever checkout is handed in. */
const appendLedgers = async ({ cwd }: { cwd: string }) => {
	await appendFriction({ cwd, runId, step: 'implement', friction: [{ kind: 'friction', area: 'plan', detail: 'the plan named no branch' }] });
	await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [finding] });
};

describe('linkRunRecords', () => {
	test("writes through to the launching checkout's runs directory", async () => {
		const { sourceCwd, workspace } = await setupLinkedWorkspace();

		await mkdir(join(workspace, '.lightsout', 'runs', runId), { recursive: true });
		await writeFile(join(workspace, '.lightsout', 'runs', runId, 'manifest.json'), '{"id":"run-isolated"}\n', 'utf8');

		expect(await readFile(join(sourceCwd, '.lightsout', 'runs', runId, 'manifest.json'), 'utf8')).toBe('{"id":"run-isolated"}\n');
	});

	test('refuses when the workspace already holds its own runs directory', async () => {
		const { sourceCwd, workspace } = await setupLinkedWorkspace({ workspaceRunsDir: true, link: false });

		const result = await linkRunRecords({ sourceCwd, workspace });

		expect(result).toEqual({ error: expect.stringContaining(join(workspace, '.lightsout', 'runs')) });
	});

	test("writes through to the launching checkout's ship-results directory too", async () => {
		const { sourceCwd, workspace } = await setupLinkedWorkspace();
		const result = ShipResult.parse({ status: 'shipped', branch, ticketRef: 'lo-9', prNumber: 42, mergeCommit: 'abc1234' });

		await writeFile(getShipResultPath({ cwd: workspace, branch }), JSON.stringify(result), 'utf8');

		expect(await readShipResult({ cwd: sourceCwd, branch })).toStrictEqual(result);
	});

	test("writes through to the launching checkout's two ledger files, creating them on first append", async () => {
		const { sourceCwd, workspace } = await setupLinkedWorkspace();

		await appendLedgers({ cwd: workspace });

		const friction = await readFriction({ cwd: sourceCwd });
		const findings = await readReviewFindings({ cwd: sourceCwd });

		expect(friction).toEqual([expect.objectContaining({ kind: 'friction', area: 'plan', detail: 'the plan named no branch', runId, step: 'implement' })]);
		expect(findings).toEqual([expect.objectContaining({ rule: 'single-return', siteKey: 'single-return:src/a.ts', runId, step: 'batch-01' })]);
	});

	test('appends to an existing ledger rather than replacing it', async () => {
		const priorFriction = {
			kind: 'friction',
			area: 'environment',
			detail: 'an earlier run said this',
			at: '2026-01-01T00:00:00.000Z',
			runId: 'run-earlier',
			step: 'write-tests',
		};
		const { sourceCwd, workspace } = await setupLinkedWorkspace({ priorFriction });

		await appendFriction({ cwd: workspace, runId, step: 'implement', friction: [{ kind: 'friction', area: 'plan', detail: 'the plan named no branch' }] });

		const lines = (await readFile(join(sourceCwd, '.lightsout', 'friction.jsonl'), 'utf8')).trim().split('\n');

		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0])).toStrictEqual(priorFriction);
	});

	test('leaves an existing correct link alone', async () => {
		const { sourceCwd, workspace } = await setupLinkedWorkspace();

		const result = await linkRunRecords({ sourceCwd, workspace });

		expect(result).toBeUndefined();
		expect(await realpath(join(workspace, '.lightsout', 'runs'))).toBe(await realpath(join(sourceCwd, '.lightsout', 'runs')));
	});
});
