import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { restorePlanWorkspace } from '#src/plan/restore/restorePlanWorkspace.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam this work exists to keep: mocking its barrel
// is what lets a restore be asserted end to end without a network. The plan
// folder itself is real and temporary, because the restore is a disk write.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

const settings = trackerSettingsFixture();
const name = 'lo-54-portable-plan';

/** An attachment per title, each answering its own title as its body so a written file names the attachment it came from. */
const setup = ({ attachments, unreadable = {} }: { attachments: string[] | TrackerFailure; unreadable?: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-restore-plan-'));

	mockGetTicketAttachments.mockResolvedValue(
		Array.isArray(attachments) ? attachments.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })) : attachments,
	);
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = Array.isArray(attachments) ? (attachments[Number(url.split('/').at(-1))] ?? '') : '';
		const failure = unreadable[title];

		return failure === undefined ? `body of ${title}\n` : { error: failure };
	});

	return { cwd, dir: join(cwd, '.lightsout', 'plans', name) };
};

const restore = ({ cwd }: { cwd: string }) => restorePlanWorkspace({ cwd, name, identifier: 'lo-54', settings });

/** What the plan folder holds, or undefined when it was never created. */
const folderOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

/** Each accepted title set that is not a plan a run can start from, with the list the refusal names back. */
const unrunnableSets: { label: string; attachments: string[]; listed: string }[] = [
	{ label: 'records with no deliverable at all', attachments: ['notes.md', 'grade.json'], listed: 'notes.md, grade.json' },
	{ label: 'an overview with no phase file', attachments: ['overview.md', 'notes.md'], listed: 'overview.md, notes.md' },
	{
		label: 'plan.md sitting beside the phase files that superseded it',
		attachments: ['plan.md', 'overview.md', 'phase1-promote.md'],
		listed: 'plan.md, overview.md, phase1-promote.md',
	},
];

describe('restorePlanWorkspace', () => {
	test('writes only the durable titles, leaving run state on the ticket', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md', 'notes.md', 'grade.json', 'facts.json', 'draft-stream.jsonl'] });

		expect(await restore({ cwd })).toStrictEqual({ restored: ['grade.json', 'notes.md', 'plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['grade.json', 'notes.md', 'plan.md']);
		expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toBe('body of plan.md\n');
	});

	test('ignores a traversing title, including the phase-prefixed one the naming pattern alone admits, and writes nothing outside the folder', async () => {
		// `phase1\..\escape.md` is the Windows-style title on a POSIX host: it holds
		// no forward slash, so `basename` answers the whole string and only the
		// explicit separator test rejects it.
		const { cwd, dir } = setup({
			attachments: ['plan.md', '../escape.md', 'phase1/../../escape.md', 'phase2/..\\escape.md', 'phase1\\..\\escape.md', '.', '..'],
		});

		expect(await restore({ cwd })).toStrictEqual({ restored: ['plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['plan.md']);
		expect(readdirSync(join(cwd, '.lightsout', 'plans'))).toStrictEqual([name]);
	});

	test('restores overview.md and every phase file of a phased plan', async () => {
		const { cwd, dir } = setup({ attachments: ['overview.md', 'phase1-promote.md', 'phase2-config.md', 'decisions.json'] });

		expect(await restore({ cwd })).toStrictEqual({ restored: ['decisions.json', 'overview.md', 'phase1-promote.md', 'phase2-config.md'] });
		expect(folderOf({ dir })).toStrictEqual(['decisions.json', 'overview.md', 'phase1-promote.md', 'phase2-config.md']);
	});

	test('writes nothing at all when one file could not be read — half a phased plan is worse than none', async () => {
		const { cwd, dir } = setup({ attachments: ['overview.md', 'phase1-promote.md', 'phase2-config.md'], unreadable: { 'phase2-config.md': 'HTTP 403' } });

		expect(await restore({ cwd })).toStrictEqual({ restored: [], error: "the ticket's phase2-config.md could not be read: HTTP 403" });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('creates no folder when the ticket carries no plan attachment, so the next run still asks the ticket', async () => {
		const { cwd, dir } = setup({ attachments: ['facts.json', 'grade-stream.jsonl'] });

		expect(await restore({ cwd })).toStrictEqual({ restored: [] });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('hands a tracker failure back as the reason the ticket could not be asked', async () => {
		const { cwd, dir } = setup({ attachments: { error: 'no ticket lo-54 in team LO' } });

		expect(await restore({ cwd })).toStrictEqual({ restored: [], error: 'no ticket lo-54 in team LO' });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test.each(unrunnableSets)('refuses $label and creates no folder, so a later publish is still fetchable', async ({ attachments, listed }) => {
		const { cwd, dir } = setup({ attachments });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: `the ticket's plan attachments (${listed}) are not a plan a run can start from — expected plan.md on its own, or overview.md with at least one phase<N> file`,
		});
		expect(folderOf({ dir })).toBeUndefined();
	});
});
