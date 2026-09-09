import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { GateHold } from '#src/contracts/index.ts';
import { getGateHoldPaths } from '#src/gates/gateHolds/common/utils/getGateHoldPaths.ts';
import { readGateHolds } from '#src/gates/gateHolds/common/utils/readGateHolds.ts';
import { removeGateHold } from '#src/gates/gateHolds/common/utils/removeGateHold.ts';
import { writeGateHold } from '#src/gates/gateHolds/common/utils/writeGateHold.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** One ticket's hold, as a coordination timeout writes it before the tracker has confirmed anything. */
const holdFor = ({ runId }: { runId: string }): GateHold => ({
	takenAt: '2026-09-08T10:00:00.000Z',
	runId,
	worktreePath: `/repo/.worktrees/${runId}`,
	reason: 'The gates never got the machine within the wait ceiling.',
	labelConfirmed: false,
});

/**
 * A primary checkout with a linked worktree added from it — the shape a queued
 * ticket runs its gates in, and the only shape where a per-worktree folder and
 * a shared one differ.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-119-gate-holds');

	execSync(`git worktree add -q -b lo-119-gate-holds "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

interface HoldsFolderParams {
	/** Hold files to plant before the act, by file name, written as raw bytes so a corrupt one can be arranged. */
	planted?: Record<string, string>;
	/** Folders to plant in the holds directory, which a read of one cannot answer bytes for. */
	plantedFolders?: string[];
}

/**
 * A directory with no repository above it, so git answers nothing and the run's
 * own `.lightsout` is the shared one — which is where these cases read and
 * write, without a checkout to stand up for each of them.
 */
const setupHoldsFolder = ({ planted, plantedFolders = [] }: HoldsFolderParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-gate-holds-'));
	const holdsDir = join(cwd, '.lightsout', 'gate-holds');

	if (planted !== undefined || plantedFolders.length > 0) {
		mkdirSync(holdsDir, { recursive: true });

		for (const [name, content] of Object.entries(planted ?? {})) {
			writeFileSync(join(holdsDir, name), content, 'utf8');
		}

		for (const name of plantedFolders) {
			mkdirSync(join(holdsDir, name), { recursive: true });
		}
	}

	return { cwd, holdsDir };
};

describe('gateHolds paths', () => {
	test('resolves the holds directory beside the reservation in the primary checkout', async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const paths = await getGateHoldPaths({ cwd: worktree });

		// asked from inside a linked worktree, the answer has to name the checkout
		// the siblings share — a worktree's own folder would give every worker a
		// private set of holds, so a ticket one of them blocked would run in the next
		expect({
			checkout: realpathSync(dirname(dirname(paths.dir))),
			tail: [basename(dirname(paths.dir)), basename(paths.dir)],
			ticketFile: paths.pathFor({ identifier: 'LO-119' }),
		}).toStrictEqual({
			checkout: realpathSync(primary),
			tail: ['.lightsout', 'gate-holds'],
			ticketFile: join(paths.dir, 'lo-119.json'),
		});
	});

	test("falls back to the run's own folder outside a repository", async () => {
		const { cwd } = setupHoldsFolder();

		const paths = await getGateHoldPaths({ cwd });

		// outside a repository there are no sibling worktrees to agree with, so the
		// run's own folder is the whole population — and answering it rather than
		// throwing is what keeps a directory that works today working
		expect(paths.dir).toBe(join(cwd, '.lightsout', 'gate-holds'));
	});

	test('answers an empty map when nothing has ever been held', async () => {
		const { cwd, holdsDir } = setupHoldsFolder();

		const holds = await readGateHolds({ cwd });

		// a repository that has never timed out has no folder at all, and that is the
		// ordinary case rather than an error — every caller gets one shape, so none
		// of them spells a "nothing here" branch of its own
		expect({ holds, folderExists: existsSync(holdsDir) }).toStrictEqual({ holds: {}, folderExists: false });
	});

	test('skips a corrupt hold file rather than losing the rest', async () => {
		const { cwd } = setupHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(holdFor({ runId: 'run-a' })),
				'lo-119.json': 'half a wri',
			},
		});

		const holds = await readGateHolds({ cwd });

		// one interrupted write must not hide every other hold on the machine: the
		// tickets those holds block would all be picked up again by the next drain
		expect(holds).toStrictEqual({ 'lo-118': holdFor({ runId: 'run-a' }) });
	});

	test('ignores an entry that is not a readable hold file', async () => {
		const { cwd } = setupHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(holdFor({ runId: 'run-a' })),
				'README.md': 'a note somebody dropped in the folder',
			},
			plantedFolders: ['lo-120.json'],
		});

		const holds = await readGateHolds({ cwd });

		// neither a neighbouring file that is not a hold nor a directory wearing the
		// hold suffix may fail the read: every other hold on the machine is refusing
		// a ticket, and losing them all would send each of those tickets to the next drain
		expect(holds).toStrictEqual({ 'lo-118': holdFor({ runId: 'run-a' }) });
	});

	test("creates the holds directory and round-trips one ticket's hold", async () => {
		const { cwd, holdsDir } = setupHoldsFolder();
		const hold = holdFor({ runId: 'run-a' });

		await writeGateHold({ cwd, identifier: 'LO-119', hold });

		const holds = await readGateHolds({ cwd });

		// the first hold a repository ever takes meets a folder that is not there, and
		// losing that one to a missing directory would let the very ticket whose gates
		// timed out run again immediately
		expect({ holds, folderExists: existsSync(holdsDir) }).toStrictEqual({ holds: { 'lo-119': hold }, folderExists: true });
	});

	test("writes one ticket's hold without touching another's", async () => {
		const neighbour = JSON.stringify(holdFor({ runId: 'run-a' }));
		const { cwd, holdsDir } = setupHoldsFolder({ planted: { 'lo-118.json': neighbour } });

		await writeGateHold({ cwd, identifier: 'LO-119', hold: holdFor({ runId: 'run-b' }) });

		// one file per ticket is the whole isolation: a writer that rewrote the folder
		// as a document would drop the hold a worker took a moment earlier, which is
		// the lost write the local record exists to prevent
		expect({
			neighbourBytes: readFileSync(join(holdsDir, 'lo-118.json'), 'utf8'),
			written: existsSync(join(holdsDir, 'lo-119.json')),
		}).toStrictEqual({ neighbourBytes: neighbour, written: true });
	});

	test('removes one hold, tolerates an absent one, and leaves the rest', async () => {
		const { cwd } = setupHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(holdFor({ runId: 'run-a' })),
				'lo-119.json': JSON.stringify(holdFor({ runId: 'run-b' })),
			},
		});

		await removeGateHold({ cwd, identifier: 'LO-118' });
		const removingAgain = removeGateHold({ cwd, identifier: 'LO-118' });

		// two drains can reconcile the same released hold at once, so the second
		// removal is an ordinary outcome and not a failure — and neither of them may
		// take another ticket's hold down with it
		await expect(removingAgain).resolves.toBeUndefined();
		const remaining = await readGateHolds({ cwd });

		expect(remaining).toStrictEqual({ 'lo-119': holdFor({ runId: 'run-b' }) });
	});
});
