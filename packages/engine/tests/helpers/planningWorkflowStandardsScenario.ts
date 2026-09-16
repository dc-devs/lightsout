import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

export const planningStandardsScenario = async () => {
	const seen: { role: string; content: string | undefined; descriptors: string[] }[] = [];
	const fixture = await planningWorkflowFixture({
		respond: async ({ snapshot, response }) => {
			seen.push({
				role: response.role,
				content: snapshot.artifacts.get('planning-standards.json'),
				descriptors: snapshot.record.standards.map((standard) => standard.sha256),
			});
			return response;
		},
	});
	fixture.runtime.config = { ...fixture.runtime.config, 'standards-packs': ['house'] };
	const documents = {
		'house/lightsout-standards.json': '{"name":"house","formatVersion":1}',
		'house/code/base/document.md': '# Contracts\nPreserve completed uploads across failed retries.',
		'house/tests/behavior/document.md': '# Behavior\nTest retry retention at the public boundary.',
	};
	for (const [path, content] of Object.entries(documents)) {
		await mkdir(join(fixture.cwd, path, '..'), { recursive: true });
		await writeFile(join(fixture.cwd, path), content);
	}
	let raced = false;
	fixture.runtime.storeIO = {
		checkpoint: async ({ operation, path }) => {
			if (raced || operation !== 'candidate') return;
			const candidate = JSON.parse(await readFile(path, 'utf8')) as { record: { artifacts: { path: string }[] } };
			if (!candidate.record.artifacts.some((artifact) => artifact.path === 'planning-standards.json')) return;
			const current = await readPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name });
			if (!current) throw new Error('Standards race requires captured input');
			raced = true;
			const result = await commitPlanningSnapshot({
				cwd: fixture.cwd,
				name: fixture.name,
				expectedRevision: current.record.revision,
				parentDigest: current.digest,
				record: { ...current.record, revision: current.record.revision + 1, parentDigest: current.digest },
				artifacts: current.artifacts,
			});
			if (!result.committed) throw new Error('Deterministic competing writer lost unexpectedly');
		},
	};
	return { ...fixture, seen, didRace: () => raced };
};
