import { describe, expect, test } from '@jest/globals';

// Dependencies
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningBrainstormHandoffFixture } from '#tests/helpers/planningBrainstormHandoffFixture.ts';

describe('commitPlanningSnapshot', () => {
	test.each(['delete', 'replace'])('preserves archived approval when a successor tries to %s its authority', async (change) => {
		const fixture = await planningBrainstormHandoffFixture();
		const before = fixture.snapshot;
		const path = 'planning-brainstorm-handoff.json';
		const artifacts = new Map(before.artifacts);
		artifacts.delete(path);
		const descriptors = before.record.artifacts.filter((artifact) => artifact.path !== path);
		if (change === 'replace') {
			const original = before.record.artifacts.find((artifact) => artifact.path === path);
			if (!original) throw new Error('Expected archived handoff');
			artifacts.set(path, '{}');
			descriptors.push({ ...original, sha256: sha256({ content: '{}' }) });
		}

		await expect(
			commitPlanningSnapshot({
				...fixture,
				expectedRevision: before.record.revision,
				parentDigest: before.digest,
				record: { ...before.record, revision: before.record.revision + 1, parentDigest: before.digest, artifacts: descriptors },
				artifacts,
			}),
		).rejects.toThrow('cannot be changed or deleted');

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(before.digest);
	});
});
