import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A state the contract accepts, written by hand so the reader is the only thing under test. */
const workOrderStateOf = ({ branch, ticketRef }: { branch: string; ticketRef: string }) => ({
	schemaVersion: 1,
	name: branch,
	ticketRef,
	branch,
	mode: 'multiple-plan',
	plans: [
		{
			id: '001-work-order-state',
			title: 'Work order state',
			progress: 'implemented',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-work-order-state' }],
});

/** Writes a work order folder's `state.json` under a checkout's shared state folder, where the reader looks for it. */
const writeStateFile = ({ cwd, name, contents }: { cwd: string; name: string; contents: string }) => {
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), contents);

	return join(workOrderFolder, 'state.json');
};

/**
 * A checkout with no repository above it, so the shared state folder is its
 * own: work order folders that exist with no state file, and hand-written state
 * files for the cases the store would never produce.
 */
const setupCheckout = ({
	emptyFolders = [],
	records = {},
	unreadable = [],
}: {
	emptyFolders?: string[];
	records?: Record<string, string>;
	/** Labels whose `state.json` is a directory, so reading it fails for a reason that is not its absence. */
	unreadable?: string[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-state-'));
	const recordPaths: Record<string, string> = {};

	for (const name of emptyFolders) {
		mkdirSync(planWorkspaceFolder({ cwd: cwd, name: name }), { recursive: true });
	}

	for (const [name, contents] of Object.entries(records)) {
		recordPaths[name] = writeStateFile({ cwd, name, contents });
	}

	for (const name of unreadable) {
		const recordPath = join(cwd, '.lightsout', 'work-orders', name, 'state.json');

		mkdirSync(recordPath, { recursive: true });
		recordPaths[name] = recordPath;
	}

	return { cwd, recordPaths };
};

/**
 * A primary checkout with a linked worktree added from it, each holding its own
 * plans folder — the shape that decides which copy of a work order's state a
 * run in a worktree reads.
 */
const setupLinkedWorktree = ({ name }: { name: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	writeStateFile({
		cwd,
		name,
		contents: JSON.stringify(workOrderStateOf({ branch: name, ticketRef: 'LO-140' })),
	});
	writeStateFile({
		cwd: worktree,
		name,
		contents: JSON.stringify(workOrderStateOf({ branch: name, ticketRef: 'LO-999' })),
	});

	return { worktree };
};

/**
 * A checkout holding one work order's state in its own folder under the shared
 * state directory, and a second copy for the same label left in the pre-layout
 * plans folder. The two name different tickets, so the answer says which of
 * the two files was read.
 */
const setupStateDirectoryCheckout = ({ name }: { name: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-dir-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: name, ticketRef: 'LO-155' })));

	const preLayoutFolder = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(preLayoutFolder, { recursive: true });
	writeFileSync(join(preLayoutFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: name, ticketRef: 'LO-000' })));

	return { cwd };
};

/**
 * A checkout with no repository above it, holding two work order folders that
 * carry the very same bytes under two different file names: one under the name
 * the store writes today, one under the name it wrote before the rename.
 */
const setupStateBesideLegacy = async ({ stateNamed, ticketNamed }: { stateNamed: string; ticketNamed: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-legacy-'));

	const folders = [
		{ name: stateNamed, fileName: 'state.json' },
		{ name: ticketNamed, fileName: 'ticket.json' },
	];

	for (const { name, fileName } of folders) {
		const folder = await workOrderFolderDir({ cwd, name });

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, fileName), JSON.stringify(workOrderStateOf({ branch: name, ticketRef: 'LO-158' })));
	}

	return { cwd };
};

describe('readWorkOrderState', () => {
	test('readWorkOrderState: reads state.json and does not fall back to a ticket.json beside it', async () => {
		const { cwd } = await setupStateBesideLegacy({ stateNamed: 'lo-158-state-file', ticketNamed: 'lo-158-legacy-file' });

		const fromStateFile = await readWorkOrderState({ cwd, name: 'lo-158-state-file' });
		const fromLegacyFile = await readWorkOrderState({ cwd, name: 'lo-158-legacy-file' });

		expect({ fromStateFile, fromLegacyFile }).toStrictEqual({
			fromStateFile: { record: workOrderStateOf({ branch: 'lo-158-state-file', ticketRef: 'LO-158' }) },
			fromLegacyFile: { record: undefined },
		});
	});

	test('answers no record when the primary checkout holds no state.json', async () => {
		const { cwd } = setupCheckout({ emptyFolders: ['lo-140-folder-only'] });

		const missingFolder = await readWorkOrderState({ cwd, name: 'lo-140-no-folder' });
		const folderWithoutRecord = await readWorkOrderState({ cwd, name: 'lo-140-folder-only' });

		expect({ missingFolder, folderWithoutRecord }).toStrictEqual({
			missingFolder: { record: undefined },
			folderWithoutRecord: { record: undefined },
		});
	});

	test("reads the primary checkout's state file when asked from a linked worktree", async () => {
		const { worktree } = setupLinkedWorktree({ name: 'lo-140-multi' });

		const read = await readWorkOrderState({ cwd: worktree, name: 'lo-140-multi' });

		expect(read).toStrictEqual({ record: workOrderStateOf({ branch: 'lo-140-multi', ticketRef: 'LO-140' }) });
	});

	test('answers an error naming the file when the state file cannot be read at all', async () => {
		const { cwd, recordPaths } = setupCheckout({ unreadable: ['lo-140-unreadable'] });

		const read = await readWorkOrderState({ cwd, name: 'lo-140-unreadable' });

		expect(read).toStrictEqual({ error: expect.stringContaining(recordPaths['lo-140-unreadable']) });
	});

	test('answers an error naming the file for a corrupt state file or one naming another branch', async () => {
		const { cwd, recordPaths } = setupCheckout({
			records: {
				'lo-140-not-json': '{ this is not json',
				// Valid JSON the contract still refuses: a mode neither member of the
				// two the state file declares, which is what a hand edit could leave.
				'lo-140-off-contract': JSON.stringify({
					...workOrderStateOf({ branch: 'lo-140-off-contract', ticketRef: 'LO-140' }),
					mode: 'multi',
				}),
				'lo-140-other-branch': JSON.stringify(workOrderStateOf({ branch: 'lo-140-somewhere-else', ticketRef: 'LO-141' })),
			},
		});

		const notJson = await readWorkOrderState({ cwd, name: 'lo-140-not-json' });
		const offContract = await readWorkOrderState({ cwd, name: 'lo-140-off-contract' });
		const otherBranch = await readWorkOrderState({ cwd, name: 'lo-140-other-branch' });

		expect({ notJson, offContract, otherBranch }).toStrictEqual({
			notJson: { error: expect.stringContaining(recordPaths['lo-140-not-json']) },
			offContract: { error: expect.stringContaining(recordPaths['lo-140-off-contract']) },
			otherBranch: { error: expect.stringContaining(recordPaths['lo-140-other-branch']) },
		});
	});

	test("readWorkOrderState: the state file is read from the work order's own folder under the shared state directory", async () => {
		const { cwd } = setupStateDirectoryCheckout({ name: 'lo-155-work-order-folder' });

		const read = await readWorkOrderState({ cwd, name: 'lo-155-work-order-folder' });
		const noFolder = await readWorkOrderState({ cwd, name: 'lo-155-no-folder' });

		expect({ read, noFolder }).toStrictEqual({
			read: { record: workOrderStateOf({ branch: 'lo-155-work-order-folder', ticketRef: 'LO-155' }) },
			noFolder: { record: undefined },
		});
	});
});
