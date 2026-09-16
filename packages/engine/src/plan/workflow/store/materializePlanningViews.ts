import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStoreIO } from '#src/plan/workflow/common/types/PlanningStoreIO.ts';
import { readPlanningFile } from '#src/plan/workflow/store/common/utils/readPlanningFile.ts';
import { writePlanningView } from '#src/plan/workflow/store/common/utils/writePlanningView.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';

interface Params {
	cwd: string;
	name: string;
	snapshot: PlanningSnapshot;
	io?: PlanningStoreIO;
}

/** Compatibility files are disposable views; stale or mixed writes request repair and never change the canonical generation. */
export const materializePlanningViews = async ({ cwd, name, snapshot, io }: Params): Promise<void> => {
	const current = await readPlanningSnapshot({ cwd, name });
	if (current === undefined) throw new Error('Planning views require a committed generation');
	const selected = current.digest === snapshot.digest ? snapshot : current;
	const workspace = planWorkspaceDir({ cwd, name });
	const descriptors = selected.record.artifacts.filter((item) => !item.path.startsWith('planning-'));
	for (const descriptor of descriptors) {
		const content = selected.artifacts.get(descriptor.path);
		if (content === undefined || sha256({ content }) !== descriptor.sha256)
			throw new Error('Planning projection input does not match its immutable descriptor');
		await writePlanningView({ workspace, path: descriptor.path, content });
		await io?.checkpoint?.({ operation: 'view', path: descriptor.path });
	}
	const marker = { format: 'planning-views-v1', generation: selected.digest, files: descriptors.map((item) => ({ path: item.path, sha256: item.sha256 })) };
	const content = canonicalJson({ value: marker });
	await writePlanningView({ workspace, path: 'planning-views.json', content });
	const latest = await readPlanningSnapshot({ cwd, name });
	if (latest?.digest !== selected.digest) throw new Error('Planning projections changed during materialization; retry with the current generation');
	for (const descriptor of descriptors) {
		const bytes = await readPlanningFile({ path: join(workspace, descriptor.path) });
		if (sha256({ content: bytes }) !== descriptor.sha256) throw new Error('Mixed planning projections detected; retry materialization');
	}
	if (!(await readPlanningFile({ path: join(workspace, 'planning-views.json') })).equals(Buffer.from(content)))
		throw new Error('Planning projection marker changed; retry materialization');
};
