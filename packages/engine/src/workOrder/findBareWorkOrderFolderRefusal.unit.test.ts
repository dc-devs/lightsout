import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { findBareWorkOrderFolderRefusal } from '#src/workOrder/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A record the contract accepts, written by hand so the refusal rule is the only thing under test. */
const workOrderStateOf = ({ branch }: { branch: string }) => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch,
	mode: 'multiple-plan',
	plans: [
		{
			id: '001-search-basics',
			title: 'Search basics',
			progress: 'ready',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-search-basics' }],
});

/**
 * A checkout with no repository above it, so the shared state folder is its
 * own: one work order folder holding a record, and one holding plan files alone
 * the way every folder did before work order states existed.
 */
const setupCheckout = ({ withRecord, legacy }: { withRecord: string; legacy: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-ticket-folder-'));
	const recordFolder = join(cwd, '.lightsout', 'work-orders', withRecord);

	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: withRecord })));
	mkdirSync(planWorkspaceFolder({ cwd: cwd, name: legacy }), { recursive: true });

	return { cwd };
};

/**
 * A checkout whose work order folder holds a `state.json` the store cannot read as
 * that folder's record, so the answer has to be the read's own sentence rather
 * than the silence that would send the name down the legacy route.
 */
const setupBrokenRecord = ({ name, contents }: { name: string; contents: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-ticket-folder-'));
	const recordFolder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'state.json'), contents);

	return { cwd };
};

/**
 * A primary checkout with a linked worktree added from it. The primary holds
 * the work order state; the worktree holds only plan files under the same folder
 * name, which is what a run standing in a worktree sees of its own `.lightsout`
 * — so this is the shape that says which checkout decides the rule.
 */
const setupLinkedWorktree = ({ withRecord, legacy }: { withRecord: string; legacy: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', withRecord);
	const recordFolder = join(cwd, '.lightsout', 'work-orders', withRecord);

	execSync(`git worktree add -q -b ${withRecord} "${worktree}" main`, { cwd, stdio: 'ignore' });
	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: withRecord })));
	mkdirSync(planWorkspaceFolder({ cwd: worktree, name: withRecord }), { recursive: true });
	mkdirSync(planWorkspaceFolder({ cwd: worktree, name: legacy }), { recursive: true });

	return { worktree };
};

/**
 * A checkout whose tickets directory holds one branch's folder with a record in
 * it, a second branch's folder with no record at all, and a third branch whose
 * only record was left in the pre-layout plans folder. That third folder is the
 * one this rule must no longer read: a record there says nothing about the
 * branch any more, so its bare name is still a legacy plan name.
 */
const setupTicketsDirectoryCheckout = ({ withRecord, withoutRecord, preLayout }: { withRecord: string; withoutRecord: string; preLayout: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-ticket-folder-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', withRecord);
	const preLayoutFolder = join(cwd, '.lightsout', 'plans', preLayout);

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: withRecord })));
	mkdirSync(join(cwd, '.lightsout', 'work-orders', withoutRecord), { recursive: true });
	mkdirSync(preLayoutFolder, { recursive: true });
	writeFileSync(join(preLayoutFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: preLayout })));

	return { cwd };
};

/**
 * A checkout with no repository above it, so the shared state folder is its
 * own: one work order folder holding its state file at `state.json`.
 *
 * The folder is spelled from `planWorkspaceFolder`'s parent rather than from a
 * path of its own, so the fixture follows the layout that helper already knows.
 */
const setupWorkOrderWithState = ({ name }: { name: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-work-order-folder-'));
	const workOrderFolder = dirname(planWorkspaceFolder({ cwd, name }));

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(workOrderStateOf({ branch: name })));

	return { cwd };
};

describe('findBareWorkOrderFolderRefusal', () => {
	test('findBareWorkOrderFolderRefusal: refuses a bare label for a work order that has state, and names work-order show', async () => {
		const { cwd } = setupWorkOrderWithState({ name: 'lo-158-has-state' });

		const bareLabel = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-158-has-state' });
		const planAddress = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-158-has-state/001-search-basics' });

		expect({ bareLabel, planAddress }).toStrictEqual({
			bareLabel: expect.stringContaining('lightsout work-order show --name lo-158-has-state'),
			planAddress: undefined,
		});
		expect(bareLabel).toEqual(expect.stringContaining("'lo-158-has-state/<plan-id>'"));
		expect(bareLabel).not.toEqual(expect.stringContaining('lightsout ticket '));
	});

	test('findBareWorkOrderFolderRefusal: refuses a bare name only when its work order folder has a work order state', async () => {
		const { cwd } = setupCheckout({ withRecord: 'lo-140-has-record', legacy: 'lo-141-legacy' });

		const planAddress = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-140-has-record/001-search-basics' });
		const bareLegacyName = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-141-legacy' });
		const bareNameWithRecord = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-140-has-record' });

		expect({ planAddress, bareLegacyName, bareNameWithRecord }).toStrictEqual({
			planAddress: undefined,
			bareLegacyName: undefined,
			bareNameWithRecord: expect.stringContaining('lightsout work-order show --name lo-140-has-record'),
		});
		expect(bareNameWithRecord).toEqual(expect.stringContaining('lo-140-has-record/'));
	});

	test('findBareWorkOrderFolderRefusal: the refusal spells the work-order command word', async () => {
		const { cwd } = setupCheckout({ withRecord: 'lo-158-has-record', legacy: 'lo-158-legacy' });

		const refusal = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-158-has-record' });

		expect(refusal).toEqual(expect.stringContaining("'lo-158-has-record/<plan-id>'"));
		expect(refusal).toEqual(expect.stringContaining('lightsout work-order show --name lo-158-has-record'));
		expect(refusal).not.toEqual(expect.stringContaining('lightsout ticket '));
	});

	test("findBareWorkOrderFolderRefusal: asked from a linked worktree, answers from the primary checkout's record", async () => {
		const { worktree } = setupLinkedWorktree({ withRecord: 'lo-140-has-record', legacy: 'lo-141-legacy' });

		const bareNameWithRecord = await findBareWorkOrderFolderRefusal({ cwd: worktree, name: 'lo-140-has-record' });
		const bareLegacyName = await findBareWorkOrderFolderRefusal({ cwd: worktree, name: 'lo-141-legacy' });

		expect({ bareNameWithRecord, bareLegacyName }).toStrictEqual({
			bareNameWithRecord: expect.stringContaining('lightsout work-order show --name lo-140-has-record'),
			bareLegacyName: undefined,
		});
	});

	test.each([
		{ flaw: 'is not valid JSON', contents: '{ not json at all', expected: 'is not valid JSON' },
		{
			flaw: 'does not match the work order state contract',
			contents: JSON.stringify({ schemaVersion: 1 }),
			expected: 'does not match the work order state contract',
		},
		{
			flaw: 'names another branch',
			contents: JSON.stringify(workOrderStateOf({ branch: 'lo-999-elsewhere' })),
			expected: "names branch 'lo-999-elsewhere'",
		},
	])('findBareWorkOrderFolderRefusal: answers the read error when the work order folder holds a state.json that $flaw', async ({ contents, expected }) => {
		const { cwd } = setupBrokenRecord({ name: 'lo-140-broken-record', contents });

		const refusal = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-140-broken-record' });

		expect(refusal).toEqual(expect.stringContaining(expected));
	});

	test("findBareWorkOrderFolderRefusal: the record is looked for in the ticket's own folder", async () => {
		const { cwd } = setupTicketsDirectoryCheckout({
			withRecord: 'lo-155-ticket-folder',
			withoutRecord: 'lo-155-no-record',
			preLayout: 'lo-155-pre-layout',
		});

		const bareNameWithRecord = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-155-ticket-folder' });
		const bareNameWithoutRecord = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-155-no-record' });
		const preLayoutName = await findBareWorkOrderFolderRefusal({ cwd, name: 'lo-155-pre-layout' });

		expect({ bareNameWithRecord, bareNameWithoutRecord, preLayoutName }).toStrictEqual({
			bareNameWithRecord: expect.stringContaining("'lo-155-ticket-folder/<plan-id>'"),
			bareNameWithoutRecord: undefined,
			preLayoutName: undefined,
		});
	});
});
