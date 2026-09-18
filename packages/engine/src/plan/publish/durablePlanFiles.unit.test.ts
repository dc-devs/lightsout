import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import { durablePlanFiles } from '#src/plan/publish/durablePlanFiles.ts';
import { restorePlanWorkspace } from '#src/plan/restore/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[]>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

// No mocks here: the subject reads a plan folder off disk, so the arrangement is
// a real temporary folder holding exactly the files each case is about. Only the
// ticket the restore case fetches from is doubled, because it would leave the
// machine.
const setupPlanFolder = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-durable-plan-files-'));
	const dir = join(cwd, '.lightsout', 'plans', 'lo-54-portable-plan');

	mkdirSync(dir, { recursive: true });

	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(dir, name), text);
	}

	return { cwd, dir, name: 'lo-54-portable-plan' };
};

/**
 * A primary checkout with a linked worktree cut from it, and a ticket carrying
 * one published generation of the plan — the shape a plan command runs in once
 * plan data stays in the main checkout.
 */
const setupTicketAndWorktree = () => {
	// The real path on both sides, because macOS's temporary directory is a
	// symlink and git answers with the directory it resolved to.
	const primary = realpathSync(setupBranchRepo().cwd);
	const worktree = join(primary, '.worktrees', 'lo-54-portable-plan');

	execSync(`git worktree add -q -b lo-54-portable-plan "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const generation = [
		{ title: 'plan.md', body: '# plan\n' },
		{ title: 'brainstorm-notes.md', body: '# notes\n' },
	];
	const marker = serializeAttachmentManifest({
		files: generation.map(({ title, body }) => ({ name: title, content: Buffer.from(body, 'utf8') })),
	}).toString('utf8');
	const assets = [...generation, { title: planAttachmentManifestName, body: marker }];

	mockGetTicketAttachments.mockResolvedValue(assets.map(({ title }, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => assets[Number(url.split('/').at(-1))]?.body ?? '');

	return { primary, worktree, dir: join(primary, '.lightsout', 'plans', 'lo-54-portable-plan'), name: 'lo-54-portable-plan' };
};

/** Run state a plan folder always holds and no publish ever carries. */
const runState = {
	'facts.json': '{}',
	'grade-history.jsonl': '{}\n',
	'draft-agent.jsonl': '{}\n',
	'manifest.json': '{}',
};

describe('durablePlanFiles', () => {
	test('a single plan travels as plan.md first, then only the records the folder actually holds', async () => {
		const { cwd, dir, name } = setupPlanFolder({ files: { 'plan.md': '# plan', 'decisions.json': '[]', ...runState } });

		expect(await durablePlanFiles({ cwd, name })).toStrictEqual({
			files: [
				{ name: 'plan.md', path: join(dir, 'plan.md') },
				{ name: 'decisions.json', path: join(dir, 'decisions.json') },
			],
		});
	});

	test('every record the folder holds travels, in the order the durable list names them', async () => {
		const { cwd, dir, name } = setupPlanFolder({
			files: { 'plan.md': '# plan', 'grade.json': '{}', 'decisions.json': '[]', 'brainstorm-notes.md': '# notes' },
		});

		expect((await durablePlanFiles({ cwd, name })).files).toStrictEqual([
			{ name: 'plan.md', path: join(dir, 'plan.md') },
			{ name: 'brainstorm-notes.md', path: join(dir, 'brainstorm-notes.md') },
			{ name: 'decisions.json', path: join(dir, 'decisions.json') },
			{ name: 'grade.json', path: join(dir, 'grade.json') },
		]);
	});

	test('the finding memory travels with a published plan', async () => {
		const { cwd, dir, name } = setupPlanFolder({
			files: {
				'plan.md': '# plan',
				'grade.json': '{}',
				'grade-memory.json': '{"planName":"lo-54-portable-plan","findings":[],"updatedAt":"2026-01-01T00:00:00.000Z"}',
				...runState,
			},
		});

		const set = await durablePlanFiles({ cwd, name });

		// Membership rather than a position: the durable list decides where the
		// memory sits beside grade.json, and what publish and restore need from
		// this file is that it travels at all.
		expect(set.files).toContainEqual({ name: 'grade-memory.json', path: join(dir, 'grade-memory.json') });
	});

	test('a phased plan travels as overview.md, then every phase file in reading order, then the records', async () => {
		const { cwd, dir, name } = setupPlanFolder({
			files: {
				'overview.md': '# overview',
				'phase2-config.md': '# two',
				'phase1-seam.md': '# one',
				'grade.json': '{}',
				...runState,
			},
		});

		expect((await durablePlanFiles({ cwd, name })).files).toStrictEqual([
			{ name: 'overview.md', path: join(dir, 'overview.md') },
			{ name: 'phase1-seam.md', path: join(dir, 'phase1-seam.md') },
			{ name: 'phase2-config.md', path: join(dir, 'phase2-config.md') },
			{ name: 'grade.json', path: join(dir, 'grade.json') },
		]);
	});

	test('a folder with no deliverable refuses by name, because the deliverable is the one file nothing can be implemented without', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'brainstorm-notes.md': '# notes', ...runState } });

		const set = await durablePlanFiles({ cwd, name });

		expect(set.files).toStrictEqual([]);
		expect(set.error ?? '').toMatch(/^nothing to publish for 'lo-54-portable-plan': no plan found for 'lo-54-portable-plan'/);
	});

	test('phase files without an overview refuse instead of publishing a folder a fresh clone cannot run', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'phase1-seam.md': '# one', 'decisions.json': '[]' } });

		expect(await durablePlanFiles({ cwd, name })).toStrictEqual({
			files: [],
			error: "nothing to publish for 'lo-54-portable-plan': phase files need an overview.md so the restored folder is a runnable phased plan",
		});
	});

	test('run state is never in the list — a transcript, the verified facts and the grade history all stay on the machine', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'plan.md': '# plan', ...runState } });

		expect((await durablePlanFiles({ cwd, name })).files.map((file) => file.name)).toStrictEqual(['plan.md']);
	});

	test('the planning progress record stays on the machine and is never listed to publish', async () => {
		const { cwd, name } = setupPlanFolder({
			files: {
				'plan.md': '# plan',
				'planning-progress.json':
					'{"name":"lo-54-portable-plan","updatedAt":"2026-01-01T00:00:00.000Z","steps":[{"step":"draft","status":"passed","attempts":1,"pid":1,"startedAt":"2026-01-01T00:00:00.000Z","finishedAt":"2026-01-01T00:00:30.000Z","durationMs":30000}]}',
			},
		});

		const set = await durablePlanFiles({ cwd, name });

		expect(set.files.map((file) => file.name)).not.toContain('planning-progress.json');
	});

	test("publish and restore act on the primary checkout's plan folder from any checkout", async () => {
		const { worktree, dir, name } = setupTicketAndWorktree();

		const restored = await restorePlanWorkspace({ cwd: worktree, name, identifier: 'lo-54', settings: trackerSettingsFixture() });
		const published = await durablePlanFiles({ cwd: worktree, name });

		// One assertion over both directions, because the claim is that they meet on
		// one folder: the restore run from the worktree writes the primary's folder,
		// and the publish run from the same worktree finds exactly those files there
		// rather than nothing at all.
		expect({
			restored: restored.restored,
			primaryFolder: readdirSync(dir).sort(),
			published: published.files,
			worktreeHoldsLightsoutData: existsSync(join(worktree, '.lightsout')),
		}).toStrictEqual({
			restored: ['brainstorm-notes.md', 'plan.md'],
			primaryFolder: ['brainstorm-notes.md', 'plan.md'],
			published: [
				{ name: 'plan.md', path: join(dir, 'plan.md') },
				{ name: 'brainstorm-notes.md', path: join(dir, 'brainstorm-notes.md') },
			],
			worktreeHoldsLightsoutData: false,
		});
	});
});
