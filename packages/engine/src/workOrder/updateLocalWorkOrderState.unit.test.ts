import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';

/** Permission bits do not apply to root, so the refused write they provoke is unreachable there. */
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = process.getuid?.() === 0 ? test.skip : test;

// A folder made read-only mid-test must be writable again, or the temp tree it
// sits in cannot be removed. Recorded at file scope so one hook restores it.
let lockedTicketFolder: string | undefined;

afterEach(() => {
	if (lockedTicketFolder !== undefined) {
		chmodSync(lockedTicketFolder, 0o755);
		lockedTicketFolder = undefined;
	}
});

/** The three history events the append-only rows start from and add to. */
const firstEvent = { at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 001-record' };
const secondEvent = { at: '2026-01-02T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdopted, detail: 'adopted the legacy folder as plan 001-record' };
const thirdEvent = { at: '2026-01-03T00:00:00.000Z', kind: WorkOrderEventKind.PlanRetitled, detail: 'retitled plan 001-record' };

/** A record the contract accepts, varied only where a row needs it to differ. */
const recordOf = ({ branch = name, history = [] }: { branch?: string; history?: WorkOrderState['history'] } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-140',
	branch,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history,
});

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout` and the work order folder is a path the test can
 * name. `contents` seeds `state.json` by hand, which is how the rows that need
 * an existing record — valid or corrupt — arrange one.
 */
const setupTicketRecord = ({ contents }: { contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const recordPath = join(workOrderFolder, 'state.json');

	if (contents !== undefined) {
		mkdirSync(workOrderFolder, { recursive: true });
		writeFileSync(recordPath, contents);
	}

	const seen: (WorkOrderState | undefined)[] = [];
	const changeTo =
		(result: WorkOrderState | { error: string }) =>
		(current: WorkOrderState | undefined): WorkOrderState | { error: string } => {
			seen.push(current);

			return result;
		};

	return { cwd, workOrderFolder, recordPath, seeded: contents, seen, changeTo };
};

/** Two checkouts and one record written twice with its keys in different orders. */
const setupDifferingKeyOrders = () => {
	const first = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const second = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const firstRecord: WorkOrderState = { schemaVersion: 1, name, ticketRef: 'LO-140', branch: name, mode: WorkOrderMode.SinglePlan, plans: [], history: [] };
	const secondRecord: WorkOrderState = { history: [], plans: [], mode: WorkOrderMode.SinglePlan, branch: name, name, ticketRef: 'LO-140', schemaVersion: 1 };

	return {
		first,
		second,
		firstRecord,
		secondRecord,
		firstPath: join(first, '.lightsout', 'work-orders', name, 'state.json'),
		secondPath: join(second, '.lightsout', 'work-orders', name, 'state.json'),
	};
};

/** The on-disk shape a fresh record takes: keys sorted at every depth, tab indented, one trailing newline. */
const expectedBytes = [
	'{',
	'\t"branch": "lo-140-multi",',
	'\t"history": [],',
	'\t"mode": "single-plan",',
	'\t"name": "lo-140-multi",',
	'\t"plans": [],',
	'\t"schemaVersion": 1,',
	'\t"ticketRef": "LO-140"',
	'}',
	'',
].join('\n');

/**
 * A checkout outside any repository whose work order folder already sits under the
 * tickets directory, holding the sync sidecar this machine wrote on its last
 * sync and a `plans` folder with one plan in it.
 *
 * The sidecar is what the record must land beside; the plans folder, and the
 * pre-layout `.lightsout/plans` directory, are what it must never land in.
 */
const setupTicketFolderLayout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-folder-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const plansFolder = join(workOrderFolder, 'plans');
	const planFile = join(plansFolder, '001-record', 'overview.md');
	const syncBytes = `${JSON.stringify({ schemaVersion: 1, planMarkers: {} })}\n`;

	mkdirSync(join(plansFolder, '001-record'), { recursive: true });
	writeFileSync(planFile, '# plan 001-record\n');
	writeFileSync(join(workOrderFolder, 'state-sync.json'), syncBytes);

	return { cwd, workOrderFolder, plansFolder, planFile, syncBytes, recordPath: join(workOrderFolder, 'state.json') };
};

/**
 * A record whose label and branch are deliberately different strings: the
 * branch carries a prefix the label does not, so a guard reading either field
 * gives a different answer and the row below can only pass on one of them.
 */
const labelledRecordOf = ({ label = name, history = [] }: { label?: string; history?: WorkOrderState['history'] } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name: label,
	branch: `feature/${name}`,
	ticketRef: 'LO-140',
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history,
});

describe('updateLocalWorkOrderState', () => {
	test('creates the work order folder and record when none exists and passes undefined to the change', async () => {
		const { cwd, workOrderFolder, recordPath, seen, changeTo } = setupTicketRecord();
		const next = recordOf();

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo(next) });

		expect(seen).toStrictEqual([undefined]);
		expect(result).toStrictEqual({ record: next });
		expect(readdirSync(workOrderFolder)).toStrictEqual(['state.json']);
		expect(readFileSync(recordPath, 'utf8')).toBe(expectedBytes);
	});

	test('writes byte-identical files for equal records whose keys were built in different orders', async () => {
		const { first, second, firstRecord, secondRecord, firstPath, secondPath } = setupDifferingKeyOrders();

		await updateLocalWorkOrderState({ cwd: first, name, change: () => firstRecord });
		await updateLocalWorkOrderState({ cwd: second, name, change: () => secondRecord });

		expect(readFileSync(secondPath, 'utf8')).toBe(readFileSync(firstPath, 'utf8'));
		expect(readFileSync(firstPath, 'utf8')).toBe(expectedBytes);
	});

	test("writes nothing and answers the change's own error when the change refuses", async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({ contents: `${JSON.stringify(recordOf(), undefined, '\t')}\n` });

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo({ error: 'plan 002-queue-order is already excluded' }) });

		expect(result).toStrictEqual({ error: 'plan 002-queue-order is already excluded' });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('refuses a changed record that fails the contract or names another branch', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({ contents: `${JSON.stringify(recordOf(), undefined, '\t')}\n` });
		const offContract = { ...recordOf(), mode: 'multi' } as unknown as WorkOrderState;

		const contractResult = await updateLocalWorkOrderState({ cwd, name, change: changeTo(offContract) });
		const branchResult = await updateLocalWorkOrderState({ cwd, name, change: changeTo(recordOf({ branch: 'lo-141-other' })) });

		// the refusal names the contract the record is parsed against, which is the
		// work-order state contract rather than anything a tracker owns
		expect(contractResult).toEqual({ error: expect.stringContaining('does not match the work-order state contract') });
		expect(contractResult).toEqual({ error: expect.not.stringContaining('the work order state contract') });
		expect(branchResult).toEqual({ error: expect.stringContaining('lo-141-other') });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('refuses a change that renames the work order', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({ contents: `${JSON.stringify(labelledRecordOf(), undefined, '\t')}\n` });

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo(labelledRecordOf({ label: 'lo-141-other' })) });

		expect(result).toEqual({ error: expect.stringContaining('lo-141-other') });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('names the work order by its label when it refuses a change that drops a recorded event', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({
			contents: `${JSON.stringify(labelledRecordOf({ history: [firstEvent, secondEvent] }), undefined, '\t')}\n`,
		});

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo(labelledRecordOf({ history: [secondEvent] })) });

		// The sentence tells a human which work order the refused change was for,
		// which is the label rather than the branch the record also names.
		expect(result).toEqual({ error: expect.stringContaining(name) });
		expect(result).toEqual({ error: expect.not.stringContaining('feature/') });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('refuses a change that drops or rewrites an earlier history event and accepts one that appends', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({
			contents: `${JSON.stringify(recordOf({ history: [firstEvent, secondEvent] }), undefined, '\t')}\n`,
		});

		const droppedResult = await updateLocalWorkOrderState({ cwd, name, change: changeTo(recordOf({ history: [secondEvent] })) });
		const rewrittenResult = await updateLocalWorkOrderState({
			cwd,
			name,
			change: changeTo(recordOf({ history: [{ ...firstEvent, detail: 'added plan 002-queue-order' }, secondEvent] })),
		});
		const unchangedAfterRefusals = readFileSync(recordPath, 'utf8');
		const appendedResult = await updateLocalWorkOrderState({
			cwd,
			name,
			change: changeTo(recordOf({ history: [firstEvent, secondEvent, thirdEvent] })),
		});

		expect(droppedResult).toEqual({ error: expect.any(String) });
		expect(rewrittenResult).toEqual({ error: expect.any(String) });
		expect(unchangedAfterRefusals).toBe(seeded);
		expect(appendedResult).toStrictEqual({ record: recordOf({ history: [firstEvent, secondEvent, thirdEvent] }) });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual([firstEvent, secondEvent, thirdEvent]);
	});

	test('answers the read error and never calls the change when the existing record is corrupt', async () => {
		const { cwd, recordPath, seeded, seen, changeTo } = setupTicketRecord({ contents: '{ this is not json' });

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo(recordOf()) });

		expect(result).toEqual({ error: expect.stringContaining(recordPath) });
		expect(seen).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('answers an error when the work order folder cannot be created', async () => {
		const { cwd, workOrderFolder, seen, changeTo } = setupTicketRecord();

		// A regular file where the work order folder belongs: the recursive create
		// cannot succeed, so nothing downstream of it may run.
		mkdirSync(join(cwd, '.lightsout', 'work-orders'), { recursive: true });
		writeFileSync(workOrderFolder, 'not a directory\n');

		const result = await updateLocalWorkOrderState({ cwd, name, change: changeTo(recordOf()) });

		expect(result).toEqual({ error: expect.stringContaining(workOrderFolder) });
		expect(seen).toStrictEqual([]);
		expect(readFileSync(workOrderFolder, 'utf8')).toBe('not a directory\n');
	});

	testUnlessRoot('answers an error naming the record when its bytes cannot be written', async () => {
		const { cwd, workOrderFolder, recordPath } = setupTicketRecord();

		const result = await updateLocalWorkOrderState({
			cwd,
			name,
			change: () => {
				// The folder stops accepting new files between the change and the
				// write: a disk that refuses the write, which the caller has to hear
				// about rather than be told its change landed.
				chmodSync(workOrderFolder, 0o555);
				lockedTicketFolder = workOrderFolder;

				return recordOf();
			},
		});

		expect(result).toEqual({ error: expect.stringContaining(recordPath) });
		expect(existsSync(recordPath)).toBe(false);
	});

	test("updateLocalWorkOrderState: the record and its sidecar are written into the ticket's own folder", async () => {
		const { cwd, workOrderFolder, plansFolder, planFile, syncBytes, recordPath } = setupTicketFolderLayout();
		const next = recordOf();

		const result = await updateLocalWorkOrderState({ cwd, name, change: () => next });

		expect({
			result,
			ticketFolderEntries: readdirSync(workOrderFolder).sort(),
			recordBytes: readFileSync(recordPath, 'utf8'),
			sidecarBytes: readFileSync(join(workOrderFolder, 'state-sync.json'), 'utf8'),
			plansFolderEntries: readdirSync(plansFolder),
			planBytes: readFileSync(planFile, 'utf8'),
			prelayoutPlansDirectory: existsSync(join(cwd, '.lightsout', 'plans')),
		}).toStrictEqual({
			result: { record: next },
			ticketFolderEntries: ['plans', 'state-sync.json', 'state.json'],
			recordBytes: expectedBytes,
			sidecarBytes: syncBytes,
			plansFolderEntries: ['001-record'],
			planBytes: '# plan 001-record\n',
			prelayoutPlansDirectory: false,
		});
	});
});
