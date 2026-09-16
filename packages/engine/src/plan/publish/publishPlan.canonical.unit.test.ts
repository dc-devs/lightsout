import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { publishPlan } from '#src/plan/publish/index.ts';
import { restorePlanWorkspace } from '#src/plan/restore/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

const mockAttachments = jest.fn<() => Promise<Array<{ id: string; title: string; url: string }>>>();
const mockRead = jest.fn<(params: { url: string }) => Promise<string>>();
const mockSet = jest.fn<(params: { title: string; content: Buffer }) => Promise<{ error: string } | undefined>>();
jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: async () => [{ id: 'ticket-144', identifier: 'LO-144' }],
	getTicketAttachments: () => mockAttachments(),
	readTicketAsset: (params: { url: string }) => mockRead(params),
	setTicketAttachment: (params: { title: string; content: Buffer }) => mockSet(params),
	resolveTrackerSettings: () => trackerSettingsFixture(),
}));

const setup = async ({ prefix, failed = false }: { prefix?: string; failed?: boolean } = {}) => {
	const name = `lo-144-canonical${prefix ? `/${prefix}` : ''}`;
	const fixture = await planningReviewFixture({ name });
	fixture.runtime.config['auto-plan'] = { 'auto-approve-plan': true };
	await fixture.run();
	const snapshot = await fixture.current();
	const assets = new Map<string, string>();
	const titles: string[] = [];
	mockSet.mockImplementation(async ({ title, content }) => {
		titles.push(title);
		if (failed && title.endsWith('planning-record.json')) return { error: 'attachment unavailable' };
		assets.set(title, content.toString('utf8'));
		await writeFile(join(fixture.root, 'plan.md'), 'concurrent flat-view edit');
		return undefined;
	});
	mockAttachments.mockImplementation(async () =>
		[...assets].map(([title], index) => ({ id: String(index), title, url: `https://assets.example/${encodeURIComponent(title)}` })),
	);
	mockRead.mockImplementation(async ({ url }) => assets.get(decodeURIComponent(url.split('/').at(-1) ?? '')) ?? '');
	const publish = () => publishPlan({ ...fixture, config: fixture.runtime.config, env: {}, onProgress: () => undefined, titlePrefix: prefix });
	const restore = async () => {
		const cwd = await freshCwd();
		const result = await restorePlanWorkspace({ cwd, name, identifier: 'LO-144', settings: trackerSettingsFixture(), titlePrefix: prefix });
		return { cwd, name, result, root: join(cwd, '.lightsout', 'plans', name) };
	};
	return { ...fixture, snapshot, assets, titles, publish, restore };
};

describe('canonical plan publication', () => {
	test.each([undefined, '001-plan'])('restores one exact published generation for legacy and nested ticket addresses (%s)', async (prefix) => {
		const fixture = await setup({ prefix });

		const published = await fixture.publish();
		const restored = await fixture.restore();
		const snapshot = await readPlanningSnapshot(restored);

		expect(published.error).toBeUndefined();
		expect(restored.result.error).toBeUndefined();
		expect(snapshot?.digest).toBe(fixture.snapshot.digest);
		expect(snapshot?.record).toEqual(fixture.snapshot.record);
		expect(await readFile(join(restored.root, 'plan.md'), 'utf8')).toBe(fixture.snapshot.artifacts.get('plan.md'));
		expect(fixture.titles.at(-1)).toBe(`${prefix ? `${prefix}--` : ''}plan-attachments.json`);
		expect(await readFile(join(restored.root, '.planning', 'selected-marker.json'), 'utf8')).toBe(fixture.assets.get(fixture.titles.at(-1) ?? ''));
	});

	test('does not commit a marker after a required canonical attachment fails', async () => {
		const fixture = await setup({ failed: true });

		const published = await fixture.publish();

		expect(published.error).toBe('attachment unavailable');
		expect(published.markerSha256).toBeUndefined();
		expect(fixture.titles.some((title) => title.endsWith('plan-attachments.json'))).toBe(false);
	});

	test('rejects a hash-consistent mixed flat view before exposing a restore folder', async () => {
		const fixture = await setup();
		await fixture.publish();
		fixture.assets.set('plan.md', 'Different plan that contradicts the canonical contract');
		fixture.assets.set(
			'plan-attachments.json',
			serializeAttachmentManifest({
				files: [...fixture.assets].filter(([name]) => name !== 'plan-attachments.json').map(([name, content]) => ({ name, content: Buffer.from(content) })),
				planningGeneration: fixture.snapshot.digest,
			}).toString('utf8'),
		);

		const restored = await fixture.restore();

		expect(restored.result.error).toContain('views differ');
		await expect(access(restored.root)).rejects.toThrow();
	});

	test('rejects a new-format marker with its canonical record removed', async () => {
		const fixture = await setup();
		await fixture.publish();
		fixture.assets.delete('planning-record.json');
		fixture.assets.set(
			'plan-attachments.json',
			serializeAttachmentManifest({
				files: [...fixture.assets].filter(([name]) => name !== 'plan-attachments.json').map(([name, content]) => ({ name, content: Buffer.from(content) })),
				planningGeneration: fixture.snapshot.digest,
			}).toString('utf8'),
		);

		const restored = await fixture.restore();

		expect(restored.result.error).toContain('requires its canonical planning-record.json');
		await expect(access(restored.root)).rejects.toThrow();
	});

	test('never publishes leftover flat files when canonical storage is missing', async () => {
		const fixture = await setup();
		await rm(join(fixture.root, '.planning'), { recursive: true });

		const published = await fixture.publish();

		expect(published.error).toContain('missing its canonical generation');
		expect(fixture.titles).toEqual([]);
	});

	test('detects a changed selected marker after restore without relying on mutable flat views', async () => {
		const fixture = await setup();
		await fixture.publish();
		const restored = await fixture.restore();
		const path = join(restored.root, '.planning', 'selected-marker.json');
		const before = await readFile(path, 'utf8');
		await writeFile(path, before.replace(fixture.snapshot.digest, sha256({ content: 'other generation' })));

		await expect(readPlanningSnapshot(restored)).rejects.toThrow('does not bind this original anchor');
	});
	test('refuses explicit canonical authority when only legacy flat files remain', async () => {
		const fixture = await setup();
		for (const path of ['.planning', 'planning-record.json', 'planning-views.json', 'planning-standards.json'])
			await rm(join(fixture.root, path), { recursive: true, force: true });

		const published = await publishPlan({
			...fixture,
			config: fixture.runtime.config,
			env: {},
			onProgress: () => undefined,
			expectedGeneration: fixture.snapshot.digest,
		});

		expect(published.error).toContain('missing its canonical generation');
		expect(fixture.titles).toEqual([]);
	});
});
