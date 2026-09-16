// Dependencies
import filesystem, { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { readPlanningEntrySnapshot, restoreBrainstormGeneration } from '#src/plan/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';

const setup = async ({ existing = false, conflict = false }: { existing?: boolean; conflict?: boolean } = {}) => {
	const fixture = await planningAlignedFixture();
	const cwd = await freshCwd();
	const directory = join(cwd, '.lightsout', 'plans', fixture.name);
	if (existing || conflict) {
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, 'facts.json'), '{"existing":"preserve"}');
		if (conflict) await writeFile(join(directory, 'brainstorm-notes.md'), 'Unpublished local work');
	}
	const marker = serializeAttachmentManifest({
		files: [...fixture.files].map(([name, content]) => ({ name, content: Buffer.from(content) })),
		brainstormGeneration: fixture.snapshot.digest,
	}).toString();
	return { ...fixture, directory, params: { cwd, name: fixture.name, files: fixture.files, generation: fixture.snapshot.digest, marker } };
};

describe('restoreBrainstormGeneration', () => {
	test('installs the exact original non-genesis authority before fresh planning entry', async () => {
		const fixture = await setup();

		const result = await restoreBrainstormGeneration(fixture.params);

		const restored = await readPlanningEntrySnapshot(fixture.params);
		expect(result.restored).toEqual(['brainstorm-decisions.json', 'brainstorm-notes.md', 'brainstorm-record.json']);
		expect(restored?.digest).toBe(fixture.snapshot.digest);
		expect(restored?.record.confirmations).toEqual(fixture.snapshot.record.confirmations);
	});

	test('preserves unrelated legacy inputs when installing a verified brainstorm anchor', async () => {
		const fixture = await setup({ existing: true });

		await restoreBrainstormGeneration(fixture.params);

		expect(await readFile(join(fixture.directory, 'facts.json'), 'utf8')).toBe('{"existing":"preserve"}');
		expect((await readPlanningEntrySnapshot(fixture.params))?.digest).toBe(fixture.snapshot.digest);
	});

	test('preserves conflicting unpublished notes and refuses to install their remote approval', async () => {
		const fixture = await setup({ conflict: true });

		await expect(restoreBrainstormGeneration(fixture.params)).rejects.toThrow('conflicts with the selected brainstorm generation');

		expect(await readFile(join(fixture.directory, 'brainstorm-notes.md'), 'utf8')).toBe('Unpublished local work');
		expect(await readPlanningEntrySnapshot(fixture.params)).toBeUndefined();
	});
	test('retains canonical recognition after a crash before exposing projections in an existing folder', async () => {
		const fixture = await setup({ existing: true });
		const link = filesystem.link;
		jest.spyOn(filesystem, 'link').mockImplementation(async (source, destination) => {
			if (destination === join(fixture.directory, 'brainstorm-notes.md')) throw new Error('simulated crash before projection');
			return link(source, destination);
		});

		await expect(restoreBrainstormGeneration(fixture.params)).rejects.toThrow('simulated crash');

		expect((await readPlanningEntrySnapshot(fixture.params))?.digest).toBe(fixture.snapshot.digest);
		await expect(readFile(join(fixture.directory, 'brainstorm-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await readFile(join(fixture.directory, 'facts.json'), 'utf8')).toBe('{"existing":"preserve"}');
	});
});

test('repeated restoration is idempotent and skips identical public projections', async () => {
	const fixture = await setup();
	await restoreBrainstormGeneration(fixture.params);
	const result = await restoreBrainstormGeneration(fixture.params);
	expect(result).toStrictEqual({ restored: [], skipped: ['brainstorm-decisions.json', 'brainstorm-notes.md', 'brainstorm-record.json'] });
});

test('restores into a private plan staging directory before it is exposed', async () => {
	const fixture = await setup({ existing: true });
	const result = await restoreBrainstormGeneration({ ...fixture.params, directory: fixture.directory });
	expect(result.restored).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md', 'brainstorm-record.json']);
	expect((await readPlanningEntrySnapshot(fixture.params))?.digest).toBe(fixture.snapshot.digest);
});

test('refuses a symlink directory without writing through it', async () => {
	const fixture = await setup();
	const other = await freshCwd();
	await mkdir(join(fixture.directory, '..'), { recursive: true });
	await filesystem.symlink(other, fixture.directory);
	await expect(restoreBrainstormGeneration(fixture.params)).rejects.toThrow('real directory');
	expect(await filesystem.readdir(other)).toStrictEqual([]);
});
