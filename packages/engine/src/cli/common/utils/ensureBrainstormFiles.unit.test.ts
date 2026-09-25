import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ensureBrainstormFiles } from '#src/cli/common/utils/ensureBrainstormFiles.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam: mocking its barrel keeps the network out
// while the real `restoreBrainstormFiles` writes into the temp repo, so what
// this fetch promises — the two files on disk and one line naming the ticket
// and the folder — is asserted against real files. `resolveTrackerSettings` is
// re-implemented rather than stubbed away, because the silent return on a repo
// with no tracker block is its own refusal.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		// Only the linear block is ever planted here, so anything else is the
		// "no tracker to ask" case this helper passes over in silence.
		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
}));
// -------------------------

const name = 'lo-117-brainstorm-decides-its-outcome';
const notesBody = '# the brainstorm write-up\n';
const decisionsBody = '{"planName":"lo-117-brainstorm-decides-its-outcome","decisions":[]}\n';

/** A repo carrying the tracker block, with one published brainstorm waiting on the ticket. */
const seedCwd = async ({ config = { 'ticket-tracker': ticketTrackerConfigBlock } }: { config?: Record<string, unknown> } = {}) => {
	const marker = serializeAttachmentManifest({
		files: [
			{ name: 'brainstorm-notes.md', content: Buffer.from(notesBody, 'utf8') },
			{ name: 'brainstorm-decisions.json', content: Buffer.from(decisionsBody, 'utf8') },
		],
	}).toString('utf8');
	const bodies: Record<string, string> = {
		'https://assets.example/brainstorm-notes.md': notesBody,
		'https://assets.example/brainstorm-decisions.json': decisionsBody,
		'https://assets.example/brainstorm-attachments.json': marker,
	};

	mockGetTicketAttachments.mockResolvedValue([
		{ id: 'att-1', title: 'brainstorm-notes.md', url: 'https://assets.example/brainstorm-notes.md' },
		{ id: 'att-2', title: 'brainstorm-decisions.json', url: 'https://assets.example/brainstorm-decisions.json' },
		{ id: 'att-3', title: 'brainstorm-attachments.json', url: 'https://assets.example/brainstorm-attachments.json' },
	]);
	mockReadTicketAsset.mockImplementation(async ({ url }) => bodies[url] ?? { error: `no asset at ${url}` });

	return seedConfiguredCwd({ config });
};

/**
 * A repo whose work order belongs to a ticket its own label does not spell, so
 * a fetch that read the ticket out of the folder name would ask for nothing at
 * all. The record is written by hand, because the look-up is what is under test.
 */
const setupRecordedWorkOrder = async ({ workOrderName, ticketRef }: { workOrderName: string; ticketRef: string }) => {
	const cwd = await seedCwd();
	const folder = join(cwd, '.lightsout', 'work-orders', workOrderName);

	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify({ schemaVersion: 1, name: workOrderName, branch: workOrderName, ticketRef, mode: 'multiple-plan', plans: [], history: [] }),
	);

	return { cwd };
};

const planNotesBody = '# the brainstorm write-up for plan 001-a\n';
const planDecisionsBody = '{"planName":"lo-9-x/001-a","decisions":[]}\n';

/**
 * A repo whose ticket carries one brainstorm generation per entry, each under
 * its own attachment title prefix — `undefined` for the bare titles a ticket
 * shaped before ticket records carries.
 */
const seedTicketCwd = async ({ generations }: { generations: { prefix?: string; notes: string; decisions: string; marker?: boolean }[] }) => {
	const attachments: Attachment[] = [];
	const bodies: Record<string, string> = {};

	for (const { prefix, notes, decisions, marker = true } of generations) {
		const files = [
			{ name: 'brainstorm-notes.md', content: Buffer.from(notes, 'utf8') },
			{ name: 'brainstorm-decisions.json', content: Buffer.from(decisions, 'utf8') },
		];
		const committed = marker ? [{ name: 'brainstorm-attachments.json', content: serializeAttachmentManifest({ files }) }] : [];

		for (const { name: fileName, content } of [...files, ...committed]) {
			const title = prefix === undefined ? fileName : `${prefix}--${fileName}`;
			const url = `https://assets.example/${title}`;

			attachments.push({ id: `att-${attachments.length + 1}`, title, url });
			bodies[url] = content.toString('utf8');
		}
	}

	mockGetTicketAttachments.mockResolvedValue(attachments);
	mockReadTicketAsset.mockImplementation(async ({ url }) => bodies[url] ?? { error: `no asset at ${url}` });

	return seedConfiguredCwd({ config: { 'ticket-tracker': ticketTrackerConfigBlock } });
};

const ensure = ({ cwd, planName = name }: { cwd: string; planName?: string }) => {
	// Which ticket a plan's brainstorm comes from is the work order record's
	// answer. A case whose label spells a ticket id gets the record that label
	// used to stand in for; a case that wrote its own record keeps it, because a
	// label spelling nothing seeds nothing.
	const label = workOrderNameOf({ name: planName });
	const spelled = /^[a-z]+-\d+/u.exec(label)?.[0];

	if (spelled !== undefined) {
		seedWorkOrderRecord({ cwd, name: label, ticketRef: spelled });
	}

	const printed: string[] = [];

	return ensureBrainstormFiles({ cwd, name: planName, write: (line) => printed.push(line) }).then(() => printed);
};

describe('ensureBrainstormFiles', () => {
	test('ensureBrainstormFiles: fetches both files and prints one line naming the ticket and the folder', async () => {
		const cwd = await seedCwd();
		const dir = planWorkspaceFolder({ cwd: cwd, name: name });

		const printed = await ensure({ cwd });

		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(printed).toStrictEqual([`lightsout: fetched 2 brainstorm file(s) from ticket lo-117 into ${dir}`]);
	});

	test('ensureBrainstormFiles: prints nothing and returns when the repo has no lightsout.config.json', async () => {
		const cwd = await freshCwd();

		const printed = await ensure({ cwd });

		expect(printed).toStrictEqual([]);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('ensureBrainstormFiles: prints one warning and returns when the restore reports an error', async () => {
		const cwd = await seedCwd();

		mockGetTicketAttachments.mockResolvedValue({ error: 'no ticket lo-117 in team LO' });

		const printed = await ensure({ cwd });

		expect(printed).toStrictEqual(['lightsout: could not fetch the brainstorm from ticket lo-117: no ticket lo-117 in team LO']);
	});

	test("ensureBrainstormFiles: for a plan address, fetches the brainstorm generation under the plan's prefix into the plan's folder", async () => {
		const cwd = await seedTicketCwd({
			generations: [
				{ prefix: '001-a', notes: planNotesBody, decisions: planDecisionsBody },
				{ notes: notesBody, decisions: decisionsBody },
			],
		});
		const dir = join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'plans', '001-a');

		const printed = await ensure({ cwd, planName: 'lo-9-x/001-a' });

		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe(planNotesBody);
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe(planDecisionsBody);
		expect(printed).toStrictEqual([`lightsout: fetched 2 brainstorm file(s) from ticket lo-9 into ${dir}`]);
	});

	test('ensureBrainstormFiles: plan 001 falls back to a bare-title brainstorm generation and no later plan does', async () => {
		const cwd = await seedTicketCwd({ generations: [{ notes: notesBody, decisions: decisionsBody }] });
		const firstDir = join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'plans', '001-a');
		const laterDir = join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'plans', '002-b');

		const printedForFirst = await ensure({ cwd, planName: 'lo-9-x/001-a' });
		const printedForLater = await ensure({ cwd, planName: 'lo-9-x/002-b' });

		expect(readFileSync(join(firstDir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(firstDir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(printedForFirst).toStrictEqual([`lightsout: fetched 2 brainstorm file(s) from ticket lo-9 into ${firstDir}`]);
		expect(existsSync(laterDir)).toBe(false);
		expect(printedForLater).toStrictEqual([]);
	});

	test("ensureBrainstormFiles: plan 001 prints one warning when the ticket's bare-title generation cannot be fetched", async () => {
		const cwd = await seedTicketCwd({ generations: [{ notes: notesBody, decisions: decisionsBody, marker: false }] });
		const dir = join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'plans', '001-a');

		const printed = await ensure({ cwd, planName: 'lo-9-x/001-a' });

		expect(printed).toStrictEqual([
			'lightsout: could not fetch the brainstorm from ticket lo-9: the ticket carries brainstorm attachments but no brainstorm-attachments.json commit marker — publish the brainstorm again',
		]);
		expect(existsSync(dir)).toBe(false);
	});

	test('ensureBrainstormFiles: for a plan address, keeps a brainstorm file already in the plan folder and reports it kept', async () => {
		const cwd = await seedTicketCwd({ generations: [{ prefix: '001-a', notes: planNotesBody, decisions: planDecisionsBody }] });
		const dir = join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'plans', '001-a');
		const mine = '# the write-up I am still editing\n';

		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'brainstorm-notes.md'), mine);

		const printed = await ensure({ cwd, planName: 'lo-9-x/001-a' });

		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe(mine);
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe(planDecisionsBody);
		expect(printed).toStrictEqual([
			`lightsout: fetched 1 brainstorm file(s) from ticket lo-9 into ${dir}`,
			'lightsout: kept the local brainstorm-notes.md — ticket lo-9 also carries it',
		]);
	});

	test("restores from the ticket the work order's record names", async () => {
		const workOrderName = 'brainstorm-decides-its-outcome';
		const { cwd } = await setupRecordedWorkOrder({ workOrderName, ticketRef: 'lo-117' });
		const dir = planWorkspaceFolder({ cwd: cwd, name: workOrderName });

		const printed = await ensure({ cwd, planName: workOrderName });

		expect(mockGetTicketAttachments).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'lo-117' }));
		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(printed).toStrictEqual([`lightsout: fetched 2 brainstorm file(s) from ticket lo-117 into ${dir}`]);
	});
});
