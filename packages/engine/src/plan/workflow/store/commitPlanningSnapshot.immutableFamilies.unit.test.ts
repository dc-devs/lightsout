import { expect, test } from '@jest/globals';
import { commitPlanningSnapshot, planningDataArtifact, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const setup = async ({ prefix }: { prefix: string }) => {
	const fixture = await planningStoreFixture();
	const path = `${prefix}/original.json`;
	const text = '{"captured":"original"}';
	fixture.artifacts.set(path, text);
	fixture.record.artifacts.push(planningDataArtifact({ path, content: text }));
	const saved = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	if (!saved.committed) throw new Error('Expected initial history fixture');
	const replacement = '{"captured":"rewritten"}';
	const artifacts = new Map(saved.snapshot.artifacts);
	artifacts.set(path, replacement);
	const record = {
		...saved.snapshot.record,
		revision: 1,
		parentDigest: saved.snapshot.digest,
		artifacts: saved.snapshot.record.artifacts.map((artifact) => (artifact.path === path ? planningDataArtifact({ path, content: replacement }) : artifact)),
	};
	return {
		...fixture,
		saved: saved.snapshot,
		path,
		text,
		candidate: { cwd: fixture.cwd, name: fixture.name, expectedRevision: 0, parentDigest: saved.snapshot.digest, record, artifacts },
	};
};

test.each([
	'planning-invocations',
	'planning-observations',
	'planning-baselines',
	'planning-questions',
	'planning-adjudication-requests',
	'planning-assurance-obligations',
	'planning-assurances',
	'planning-failures',
	'planning-structural',
])('retains immutable %s bytes when a later candidate attempts to rewrite history', async (prefix) => {
	const fixture = await setup({ prefix });

	await expect(commitPlanningSnapshot(fixture.candidate)).rejects.toThrow(/cannot be changed or deleted/);
	const current = await readPlanningSnapshot(fixture);

	expect(current?.digest).toBe(fixture.saved.digest);
	expect(current?.artifacts.get(fixture.path)).toBe(fixture.text);
});
