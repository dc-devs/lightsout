import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { createWorkOrder } from '#src/workOrder/createWorkOrder.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { queueConfigBlock, ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only module seam: the records and their folders are
// real files in a temporary checkout, and the harness is a stub driver, because
// what this function promises is which bytes reach disk and which label they are
// filed under.
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
/** What the tracker answers for LO-158 — a sentence, which is the whole reason a summariser stands between it and the label. */
const trackerTitle = "A ticket's branch name has no single author today";
/** The words the stub harness answers, and so the words every label below carries. */
const summarisedWords = 'give-the-name-one';

/** A work order already on this machine, in the smallest shape the state contract accepts. */
const recordOf = ({ name, branch = name, ticketRef }: { name: string; branch?: string; ticketRef?: string }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	branch,
	...(ticketRef === undefined ? {} : { ticketRef }),
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: [],
});

const setupCreate = async ({
	config = { gates },
	words = summarisedWords,
	/** The reference the tracker spells back, whatever case the caller typed. */
	identifier = 'LO-158',
	title = trackerTitle,
	existing = [],
	/** A folder planted under the work-orders directory whose record will not parse. */
	unreadableFolder,
}: {
	config?: LightsoutConfig;
	words?: string;
	identifier?: string;
	title?: string;
	existing?: WorkOrderState[];
	unreadableFolder?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-new-'));
	const workOrdersFolder = join(cwd, '.lightsout', 'work-orders');
	const invocations: DriverInvocation[] = [];
	const progress: string[] = [];

	for (const record of existing) {
		await updateLocalWorkOrderState({ cwd, name: record.name, change: () => record });
	}

	if (unreadableFolder !== undefined) {
		mkdirSync(join(workOrdersFolder, unreadableFolder), { recursive: true });
		writeFileSync(join(workOrdersFolder, unreadableFolder, 'state.json'), '{ half a record');
	}

	// Narrowed to the three fields the title read uses: the rest of a tracker's
	// issue shape would say nothing about which name gets written.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-158', identifier, title } as TrackerTicket]);

	const driver = recordingDriver({
		driver: { name: 'stub', invoke: async () => ({ text: JSON.stringify({ words }), exitCode: 0 }) },
		invocations,
	});

	return {
		cwd,
		workOrdersFolder,
		invocations,
		recordPathOf: ({ name }: { name: string }) => join(workOrdersFolder, name, 'state.json'),
		params: { cwd, config, env: { LINEAR_API_KEY: 'lin_key' }, driver, onProgress: (message: string) => progress.push(message) },
	};
};

/** The record as it stands on disk, which is what every later command reads. */
const recordAt = ({ path }: { path: string }) => JSON.parse(readFileSync(path, 'utf8')) as WorkOrderState;

test('createWorkOrder: --title with no tracker writes a record carrying the slugged name, the rendered branch and no ticket reference', async () => {
	const { params, recordPathOf } = await setupCreate({ config: { gates, plan: { 'default-work-order-mode': WorkOrderMode.MultiplePlan } } });

	const result = await createWorkOrder({ ...params, title: 'Give the name one author' });

	expect(result).toEqual(expect.objectContaining({ name: 'give-the-name-one-author', branch: 'give-the-name-one-author' }));
	// Whole-record rather than partial: the absence of `ticketRef` is half of
	// what this row states, and a partial match cannot see a field that is not there.
	expect(recordAt({ path: recordPathOf({ name: 'give-the-name-one-author' }) })).toStrictEqual({
		schemaVersion: 1,
		name: 'give-the-name-one-author',
		branch: 'give-the-name-one-author',
		mode: 'multiple-plan',
		plans: [],
		history: [],
	});
});

test('createWorkOrder: refuses neither flag and both flags, naming the pair and leaving the work-orders directory untouched', async () => {
	const { params, workOrdersFolder } = await setupCreate({ config: { gates, 'ticket-tracker': trackerBlock } });

	const neither = await createWorkOrder(params);
	const both = await createWorkOrder({ ...params, ticketRef: 'LO-158', title: 'Give the name one author' });

	expect(neither).toEqual({ error: expect.stringContaining('--ticket') });
	expect(neither).toEqual({ error: expect.stringContaining('--title') });
	expect(both).toEqual({ error: expect.stringContaining('--ticket') });
	expect(both).toEqual({ error: expect.stringContaining('--title') });
	expect(existsSync(workOrdersFolder)).toBe(false);
});

test('createWorkOrder: refuses words that hold nothing a label can be built from, and writes nothing', async () => {
	const { params, workOrdersFolder } = await setupCreate();

	const result = await createWorkOrder({ ...params, title: '???' });

	// The composer's refusal is carried out to the terminal rather than becoming
	// an empty folder name, which is the one label no later command could read.
	expect(result).toEqual({ error: expect.stringContaining('???') });
	expect(existsSync(workOrdersFolder)).toBe(false);
});

test('createWorkOrder: refuses a ticket reference a work order already carries, before composing a label', async () => {
	const { params, workOrdersFolder, invocations } = await setupCreate({
		config: { gates, 'ticket-tracker': trackerBlock },
		existing: [recordOf({ name: 'lo-158-an-earlier-name', ticketRef: 'LO-158' })],
	});

	const result = await createWorkOrder({ ...params, ticketRef: 'LO-158' });

	// The summariser answers different words each run, so the label could never
	// catch this: the refusal has to turn on the reference the record carries.
	expect(result).toEqual({ error: expect.stringContaining('lo-158-an-earlier-name') });
	expect(result).toEqual({ error: expect.stringContaining('--title') });
	expect(mockGetTicketsByIdentifiers).toHaveBeenCalledTimes(1);
	expect(invocations).toStrictEqual([]);
	expect(readdirSync(workOrdersFolder)).toStrictEqual(['lo-158-an-earlier-name']);
});

test('createWorkOrder: stores the reference as the tracker spells it, not as the caller typed it', async () => {
	const { params, recordPathOf } = await setupCreate({ config: { gates, 'ticket-tracker': trackerBlock } });

	const result = await createWorkOrder({ ...params, ticketRef: 'lo-158' });

	expect(result).toEqual(expect.objectContaining({ name: 'lo-158-give-the-name-one' }));
	expect(recordAt({ path: recordPathOf({ name: 'lo-158-give-the-name-one' }) })).toEqual(expect.objectContaining({ ticketRef: 'LO-158' }));
});

test("createWorkOrder: the branch's slug is the summarised words, so the label and the branch agree under the default template", async () => {
	const { params, recordPathOf } = await setupCreate({ config: { gates, 'ticket-tracker': trackerBlock } });

	const result = await createWorkOrder({ ...params, ticketRef: 'LO-158' });

	const written = recordAt({ path: recordPathOf({ name: 'lo-158-give-the-name-one' }) });

	expect(result).toEqual(expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'lo-158-give-the-name-one' }));
	expect(written.branch).toBe('lo-158-give-the-name-one');
	// The tracker's own sentence would have rendered `lo-158-a-ticket-s-branch-name-has-no`,
	// which is a different string from the label the same call composed.
	expect(written.branch).not.toContain('branch-name');
});

test('createWorkOrder: refuses a label another work order holds, names it, and leaves that record untouched', async () => {
	const { params, recordPathOf } = await setupCreate({
		config: { gates, 'ticket-tracker': trackerBlock },
		existing: [recordOf({ name: 'lo-158-give-the-name-one', ticketRef: 'LO-999' })],
	});
	const before = readFileSync(recordPathOf({ name: 'lo-158-give-the-name-one' }), 'utf8');

	const result = await createWorkOrder({ ...params, ticketRef: 'LO-158' });

	expect(result).toEqual({ error: expect.stringContaining('lo-158-give-the-name-one') });
	expect(result).toEqual({ error: expect.stringContaining('--title') });
	expect(readFileSync(recordPathOf({ name: 'lo-158-give-the-name-one' }), 'utf8')).toBe(before);
});

test('createWorkOrder: refuses while any work-order folder cannot be read, naming it, and writes nothing', async () => {
	const { params, workOrdersFolder } = await setupCreate({ unreadableFolder: 'half-written-work' });

	const result = await createWorkOrder({ ...params, title: 'Give the name one author' });

	// A folder the engine cannot read is a work order it cannot see, and creation
	// is the one operation that must not act on a partial view of what exists.
	expect(result).toEqual({ error: expect.stringContaining('half-written-work') });
	expect(readdirSync(workOrdersFolder)).toStrictEqual(['half-written-work']);
});

test('createWorkOrder: a prefixed branch template stores a branch that differs from the label, and the label keeps no slash', async () => {
	const { params, workOrdersFolder, recordPathOf } = await setupCreate({
		config: { gates, 'ticket-tracker': trackerBlock, queue: { ...queueConfigBlock, 'branch-template': 'feature/{ticket}-{slug}' } },
	});

	const result = await createWorkOrder({ ...params, ticketRef: 'LO-158' });

	// One folder directly under the work-orders directory is what proves the
	// prefix never reached a path: a slash in the label would have nested it.
	expect(result).toEqual(expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'feature/lo-158-give-the-name-one' }));
	expect(recordAt({ path: recordPathOf({ name: 'lo-158-give-the-name-one' }) })).toEqual(
		expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'feature/lo-158-give-the-name-one' }),
	);
	expect(readdirSync(workOrdersFolder)).toStrictEqual(['lo-158-give-the-name-one']);
});

test('createWorkOrder: a handed mode is the mode written to the new record, and without one the repository default is', async () => {
	const { params, recordPathOf } = await setupCreate({
		config: { gates, 'ticket-tracker': trackerBlock, plan: { 'default-work-order-mode': WorkOrderMode.MultiplePlan } },
	});

	const handed = await createWorkOrder({ ...params, ticketRef: 'LO-158', mode: WorkOrderMode.SinglePlan });
	const defaulted = await createWorkOrder({ ...params, title: 'Give the name one author' });

	// Read back from disk rather than from the returned record: the mode has to
	// survive the whole way from the creator into the file every later command reads.
	expect(handed).toEqual(expect.objectContaining({ name: 'lo-158-give-the-name-one' }));
	expect(recordAt({ path: recordPathOf({ name: 'lo-158-give-the-name-one' }) }).mode).toBe('single-plan');
	expect(defaulted).toEqual(expect.objectContaining({ name: 'give-the-name-one-author' }));
	expect(recordAt({ path: recordPathOf({ name: 'give-the-name-one-author' }) }).mode).toBe('multiple-plan');
});
