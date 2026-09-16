// Dependencies
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningPortableFixture as setup } from '#tests/helpers/planningPortableFixture.ts';

describe('readPlanningSnapshot', () => {
	test.each(['core', 'anchor'])('detects %s corruption after an earlier successful anchored read', async (target) => {
		const fixture = await setup();
		const restored = await fixture.restore();
		const digest =
			target === 'anchor' ? sha256({ content: fixture.text }) : restored.snapshot.record.artifacts.find((item) => item.path === 'custom-data.json')?.sha256;
		if (!digest) throw new Error('Missing corruption target');
		await writeFile(join(restored.root, '.planning', 'blobs', digest), 'corrupt');

		await expect(readPlanningSnapshot(restored)).rejects.toThrow(/marker|Corrupt/);
	});

	test('rehydrates only the exact original observation content address', async () => {
		const fixture = await setup();
		const restored = await fixture.restore();
		const original = fixture.snapshot.artifacts.get(fixture.observationPath);
		if (!original) throw new Error('Missing local observation');
		const path = join(restored.root, '.planning', 'blobs', sha256({ content: original }));
		await writeFile(path, original);

		const rehydrated = await readPlanningSnapshot(restored);

		expect(rehydrated?.artifacts.get(fixture.observationPath)).toBe(original);
		expect(rehydrated?.digest).toBe(restored.snapshot.digest);
		expect(await readFile(path, 'utf8')).toBe(original);
	});
});

test.each(['format', 'generation', 'encoding', 'missing-core'])('refuses damaged restored anchor state: %s', async (defect) => {
	const fixture = await setup();
	const restored = await fixture.restore();
	const root = join(restored.root, '.planning');
	const anchorPath = join(root, 'anchor.json');
	const reference = JSON.parse(await readFile(anchorPath, 'utf8'));
	if (defect === 'format') await writeFile(anchorPath, JSON.stringify(reference, null, 2));
	if (defect === 'generation') await writeFile(anchorPath, canonicalJson({ value: { ...reference, generation: 'a'.repeat(64) } }));
	if (defect === 'encoding') await writeFile(join(root, 'blobs', reference.sha256), Buffer.from([0xff]));
	if (defect === 'missing-core') {
		const descriptor = restored.snapshot.record.artifacts.find((item) => item.path === 'custom-data.json');
		if (!descriptor) throw new Error('Expected core descriptor');
		await rm(join(root, 'blobs', descriptor.sha256));
	}
	await expect(readPlanningSnapshot(restored)).rejects.toThrow(/Noncanonical|generation differs|encoding|ENOENT/);
});
