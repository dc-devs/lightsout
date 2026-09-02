import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { isDurablePlanAttachmentName, planAttachmentManifestName, serializePlanAttachmentManifest } from '#src/plan/common/planAttachmentManifest.ts';
import { restorePlanWorkspace } from '#src/plan/restore/restorePlanWorkspace.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
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

const overviewBody = ({ phases }: { phases: string[] }) =>
	`# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${phases.map((phase, index) => `| ${index + 1} | \`${phase}\` | scope |`).join('\n')}\n`;

interface SetupParams {
	attachments: string[] | TrackerFailure;
	bodies?: Record<string, string>;
	unreadable?: Record<string, string>;
	/** Durable files committed by the manifest. Defaults to every unique durable attachment title. */
	manifestFiles?: string[];
	/** Exact manifest body for malformed/version/hash cases. */
	manifestText?: string;
	/** Zero exercises pre-manifest tickets; two exercises an ambiguous commit marker. */
	manifestCopies?: number;
}

/**
 * Build a ticket generation. Durable assets get a valid manifest by default;
 * unrelated and stale assets can sit beside the manifest without entering it.
 */
const setup = ({ attachments, bodies = {}, unreadable = {}, manifestFiles, manifestText, manifestCopies }: SetupParams) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-restore-plan-'));

	if (!Array.isArray(attachments)) {
		mockGetTicketAttachments.mockResolvedValue(attachments);
		mockReadTicketAsset.mockResolvedValue({ error: 'unexpected asset read' });

		return { cwd, dir: join(cwd, '.lightsout', 'plans', name) };
	}

	const durable = [...new Set(attachments.filter((title) => isDurablePlanAttachmentName({ name: title })))];
	const listed = manifestFiles ?? durable;
	const phases = listed.filter((title) => title !== 'plan.md' && title !== 'overview.md' && /^phase\d+.*\.md$/.test(title));
	const bodyOf = (title: string) => bodies[title] ?? (title === 'overview.md' ? overviewBody({ phases }) : `body of ${title}\n`);
	const copies = manifestCopies ?? (durable.length > 0 ? 1 : 0);
	const marker =
		manifestText ??
		serializePlanAttachmentManifest({ files: listed.map((file) => ({ name: file, content: Buffer.from(bodyOf(file), 'utf8') })) }).toString('utf8');
	const titles = [...attachments, ...Array.from({ length: copies }, () => planAttachmentManifestName)];
	const assetBodies = titles.map((title) => (title === planAttachmentManifestName ? marker : bodyOf(title)));

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const index = Number(url.split('/').at(-1));
		const title = titles[index] ?? '';
		const failure = unreadable[title];

		return failure === undefined ? (assetBodies[index] ?? '') : { error: failure };
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

describe('restorePlanWorkspace', () => {
	test('writes only the manifest-listed durable generation, leaving transport metadata, stale files and run state on the ticket', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md', 'notes.md', 'grade.json', 'overview.md', 'phase1-old.md', 'facts.json', 'draft-stream.jsonl'],
			manifestFiles: ['plan.md', 'notes.md', 'grade.json'],
		});

		expect(await restore({ cwd })).toStrictEqual({ restored: ['grade.json', 'notes.md', 'plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['grade.json', 'notes.md', 'plan.md']);
		expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toBe('body of plan.md\n');
	});

	test('ignores traversing and unlisted titles and writes nothing outside the folder', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md', '../escape.md', 'phase1/../../escape.md', 'phase2/..\\escape.md', 'phase1\\..\\escape.md', '.', '..'],
		});

		expect(await restore({ cwd })).toStrictEqual({ restored: ['plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['plan.md']);
		expect(readdirSync(join(cwd, '.lightsout', 'plans'))).toStrictEqual([name]);
	});

	test('restores overview.md and the exact phase files declared in its Phases table', async () => {
		const { cwd, dir } = setup({ attachments: ['overview.md', 'phase1-promote.md', 'phase2-config.md', 'decisions.json'] });

		expect(await restore({ cwd })).toStrictEqual({ restored: ['decisions.json', 'overview.md', 'phase1-promote.md', 'phase2-config.md'] });
		expect(folderOf({ dir })).toStrictEqual(['decisions.json', 'overview.md', 'phase1-promote.md', 'phase2-config.md']);
	});

	test('ignores a stale single-plan attachment when the manifest commits a phased generation', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md', 'overview.md', 'phase1-promote.md'],
			manifestFiles: ['overview.md', 'phase1-promote.md'],
		});

		expect(await restore({ cwd })).toStrictEqual({ restored: ['overview.md', 'phase1-promote.md'] });
		expect(folderOf({ dir })).toStrictEqual(['overview.md', 'phase1-promote.md']);
	});

	test('requires the overview Phases table to name exactly the committed phase files', async () => {
		const { cwd, dir } = setup({
			attachments: ['overview.md', 'phase1-promote.md'],
			bodies: { 'overview.md': overviewBody({ phases: ['phase1-promote.md', 'phase2-missing.md'] }) },
		});

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: "overview.md's Phases table (phase1-promote.md, phase2-missing.md) does not exactly match the plan generation's phase files (phase1-promote.md)",
		});
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('writes nothing when one selected file cannot be read', async () => {
		const { cwd, dir } = setup({
			attachments: ['overview.md', 'phase1-promote.md', 'phase2-config.md'],
			unreadable: { 'phase2-config.md': 'HTTP 403' },
		});

		expect(await restore({ cwd })).toStrictEqual({ restored: [], error: "the ticket's phase2-config.md could not be read: HTTP 403" });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('refuses a file whose bytes do not match the committed hash', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md'],
			manifestText: JSON.stringify({ schemaVersion: 1, files: [{ name: 'plan.md', sha256: '0'.repeat(64) }] }),
		});

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: `plan.md does not match the SHA-256 committed by ${planAttachmentManifestName} — publish the plan again`,
		});
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('a disk refusal exposes no partial restored folder and returns the filesystem reason', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md', 'notes.md'] });

		mkdirSync(join(cwd, '.lightsout', 'plans'), { recursive: true });
		writeFileSync(dir, 'occupied by a file');

		const restored = await restore({ cwd });

		expect(restored.restored).toStrictEqual([]);
		expect(restored.error).toEqual(expect.stringContaining('the restored plan could not be written:'));
		expect(readFileSync(dir, 'utf8')).toBe('occupied by a file');
		expect(readdirSync(join(cwd, '.lightsout', 'plans'))).toStrictEqual([name]);
	});

	test('creates no folder when the ticket carries no plan attachment', async () => {
		const { cwd, dir } = setup({ attachments: ['facts.json', 'grade-stream.jsonl'] });

		expect(await restore({ cwd })).toStrictEqual({ restored: [] });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('requires a manifest whenever durable plan attachments exist', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md'], manifestCopies: 0 });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: `the ticket carries durable plan attachments but no ${planAttachmentManifestName} commit marker — publish the plan again before implementing it`,
		});
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockReadTicketAsset).not.toHaveBeenCalled();
	});

	test('requires exactly one manifest commit marker', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md'], manifestCopies: 2 });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: `the ticket carries more than one ${planAttachmentManifestName} attachment, so no single committed plan generation can be selected`,
		});
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockReadTicketAsset).not.toHaveBeenCalled();
	});

	test('refuses an invalid manifest before selecting or reading plan files', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md'], manifestText: '{not json' });

		const result = await restore({ cwd });

		expect(result.restored).toStrictEqual([]);
		expect(result.error).toMatch(/^plan-attachments\.json is not valid JSON:/);
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockReadTicketAsset).toHaveBeenCalledTimes(1);
	});

	test('refuses duplicate attachments for a manifest-listed title', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md', 'plan.md'], manifestFiles: ['plan.md'] });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: `the ticket carries more than one attachment named plan.md, so ${planAttachmentManifestName} cannot select one generation`,
		});
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('refuses plan.md coexisting with overview.md even when no phase title is present', async () => {
		const { cwd, dir } = setup({ attachments: ['plan.md', 'overview.md'] });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: 'the plan generation (plan.md, overview.md) is not runnable — plan.md must not coexist with overview.md or phase files',
		});
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('refuses records with no deliverable and creates no folder', async () => {
		const { cwd, dir } = setup({ attachments: ['notes.md', 'grade.json'] });

		expect(await restore({ cwd })).toStrictEqual({
			restored: [],
			error: 'the plan generation (notes.md, grade.json) is not runnable — expected plan.md on its own, or overview.md with at least one phase<N> file',
		});
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('hands a tracker failure back as the concrete restore reason', async () => {
		const { cwd, dir } = setup({ attachments: { error: 'no ticket lo-54 in team LO' } });

		expect(await restore({ cwd })).toStrictEqual({ restored: [], error: 'no ticket lo-54 in team LO' });
		expect(folderOf({ dir })).toBeUndefined();
	});
});
