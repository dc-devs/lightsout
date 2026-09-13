import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { updateLocalTicketRecord } from '#src/ticket/index.ts';

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';

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
const firstEvent = { at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: 'added plan 001-record' };
const secondEvent = { at: '2026-01-02T00:00:00.000Z', kind: TicketEventKind.PlanAdopted, detail: 'adopted the legacy folder as plan 001-record' };
const thirdEvent = { at: '2026-01-03T00:00:00.000Z', kind: TicketEventKind.PlanRetitled, detail: 'retitled plan 001-record' };

/** A record the contract accepts, varied only where a row needs it to differ. */
const recordOf = ({ branch = ticketBranch, history = [] }: { branch?: string; history?: TicketRecord['history'] } = {}): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch,
	mode: TicketMode.SinglePlan,
	plans: [],
	history,
});

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout` and the ticket folder is a path the test can
 * name. `contents` seeds `ticket.json` by hand, which is how the rows that need
 * an existing record — valid or corrupt — arrange one.
 */
const setupTicketRecord = ({ contents }: { contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');

	if (contents !== undefined) {
		mkdirSync(ticketFolder, { recursive: true });
		writeFileSync(recordPath, contents);
	}

	const seen: (TicketRecord | undefined)[] = [];
	const changeTo =
		(result: TicketRecord | { error: string }) =>
		(current: TicketRecord | undefined): TicketRecord | { error: string } => {
			seen.push(current);

			return result;
		};

	return { cwd, ticketFolder, recordPath, seeded: contents, seen, changeTo };
};

/** Two checkouts and one record written twice with its keys in different orders. */
const setupDifferingKeyOrders = () => {
	const first = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const second = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const firstRecord: TicketRecord = { schemaVersion: 1, ticketRef: 'LO-140', branch: ticketBranch, mode: TicketMode.SinglePlan, plans: [], history: [] };
	const secondRecord: TicketRecord = { history: [], plans: [], mode: TicketMode.SinglePlan, branch: ticketBranch, ticketRef: 'LO-140', schemaVersion: 1 };

	return {
		first,
		second,
		firstRecord,
		secondRecord,
		firstPath: join(first, '.lightsout', 'plans', ticketBranch, 'ticket.json'),
		secondPath: join(second, '.lightsout', 'plans', ticketBranch, 'ticket.json'),
	};
};

/** The on-disk shape a fresh record takes: keys sorted at every depth, tab indented, one trailing newline. */
const expectedBytes = [
	'{',
	'\t"branch": "lo-140-multi",',
	'\t"history": [],',
	'\t"mode": "single-plan",',
	'\t"plans": [],',
	'\t"schemaVersion": 1,',
	'\t"ticketRef": "LO-140"',
	'}',
	'',
].join('\n');

describe('updateLocalTicketRecord', () => {
	test('creates the ticket folder and record when none exists and passes undefined to the change', async () => {
		const { cwd, ticketFolder, recordPath, seen, changeTo } = setupTicketRecord();
		const next = recordOf();

		const result = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(next) });

		expect(seen).toStrictEqual([undefined]);
		expect(result).toStrictEqual({ record: next });
		expect(readdirSync(ticketFolder)).toStrictEqual(['ticket.json']);
		expect(readFileSync(recordPath, 'utf8')).toBe(expectedBytes);
	});

	test('writes byte-identical files for equal records whose keys were built in different orders', async () => {
		const { first, second, firstRecord, secondRecord, firstPath, secondPath } = setupDifferingKeyOrders();

		await updateLocalTicketRecord({ cwd: first, ticketBranch, change: () => firstRecord });
		await updateLocalTicketRecord({ cwd: second, ticketBranch, change: () => secondRecord });

		expect(readFileSync(secondPath, 'utf8')).toBe(readFileSync(firstPath, 'utf8'));
		expect(readFileSync(firstPath, 'utf8')).toBe(expectedBytes);
	});

	test("writes nothing and answers the change's own error when the change refuses", async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({ contents: `${JSON.stringify(recordOf(), undefined, '\t')}\n` });

		const result = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo({ error: 'plan 002-queue-order is already excluded' }) });

		expect(result).toStrictEqual({ error: 'plan 002-queue-order is already excluded' });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('refuses a changed record that fails the contract or names another branch', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({ contents: `${JSON.stringify(recordOf(), undefined, '\t')}\n` });
		const offContract = { ...recordOf(), mode: 'multi' } as unknown as TicketRecord;

		const contractResult = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(offContract) });
		const branchResult = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(recordOf({ branch: 'lo-141-other' })) });

		expect(contractResult).toEqual({ error: expect.any(String) });
		expect(branchResult).toEqual({ error: expect.stringContaining('lo-141-other') });
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('refuses a change that drops or rewrites an earlier history event and accepts one that appends', async () => {
		const { cwd, recordPath, seeded, changeTo } = setupTicketRecord({
			contents: `${JSON.stringify(recordOf({ history: [firstEvent, secondEvent] }), undefined, '\t')}\n`,
		});

		const droppedResult = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(recordOf({ history: [secondEvent] })) });
		const rewrittenResult = await updateLocalTicketRecord({
			cwd,
			ticketBranch,
			change: changeTo(recordOf({ history: [{ ...firstEvent, detail: 'added plan 002-queue-order' }, secondEvent] })),
		});
		const unchangedAfterRefusals = readFileSync(recordPath, 'utf8');
		const appendedResult = await updateLocalTicketRecord({
			cwd,
			ticketBranch,
			change: changeTo(recordOf({ history: [firstEvent, secondEvent, thirdEvent] })),
		});

		expect(droppedResult).toEqual({ error: expect.any(String) });
		expect(rewrittenResult).toEqual({ error: expect.any(String) });
		expect(unchangedAfterRefusals).toBe(seeded);
		expect(appendedResult).toStrictEqual({ record: recordOf({ history: [firstEvent, secondEvent, thirdEvent] }) });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual([firstEvent, secondEvent, thirdEvent]);
	});

	test('answers the read error and never calls the change when the existing record is corrupt', async () => {
		const { cwd, recordPath, seeded, seen, changeTo } = setupTicketRecord({ contents: '{ this is not json' });

		const result = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(recordOf()) });

		expect(result).toEqual({ error: expect.stringContaining(recordPath) });
		expect(seen).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(seeded);
	});

	test('answers an error when the ticket folder cannot be created', async () => {
		const { cwd, ticketFolder, seen, changeTo } = setupTicketRecord();

		// A regular file where the ticket folder belongs: the recursive create
		// cannot succeed, so nothing downstream of it may run.
		mkdirSync(join(cwd, '.lightsout', 'plans'), { recursive: true });
		writeFileSync(ticketFolder, 'not a directory\n');

		const result = await updateLocalTicketRecord({ cwd, ticketBranch, change: changeTo(recordOf()) });

		expect(result).toEqual({ error: expect.stringContaining(ticketFolder) });
		expect(seen).toStrictEqual([]);
		expect(readFileSync(ticketFolder, 'utf8')).toBe('not a directory\n');
	});

	testUnlessRoot('answers an error naming the record when its bytes cannot be written', async () => {
		const { cwd, ticketFolder, recordPath } = setupTicketRecord();

		const result = await updateLocalTicketRecord({
			cwd,
			ticketBranch,
			change: () => {
				// The folder stops accepting new files between the change and the
				// write: a disk that refuses the write, which the caller has to hear
				// about rather than be told its change landed.
				chmodSync(ticketFolder, 0o555);
				lockedTicketFolder = ticketFolder;

				return recordOf();
			},
		});

		expect(result).toEqual({ error: expect.stringContaining(recordPath) });
		expect(existsSync(recordPath)).toBe(false);
	});
});
