import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PipelineKind, type PlanningRecord } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/common/utils/planningDataArtifact.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';

interface Params {
	cwd: string;
	name: string;
	record: PlanningRecord;
	artifacts: Map<string, string>;
}

/** Pin existing implementation inputs before compatibility views can replace their root files. */
export const captureLegacyRunInputs = async ({ cwd, name, record, artifacts }: Params): Promise<void> => {
	const runs = join(cwd, '.lightsout', 'runs');
	let names: string[];
	try {
		names = await readdir(runs);
	} catch (error) {
		if (planningErrorCode({ error }) === 'ENOENT') return;
		throw error;
	}
	const entries: Array<{ runId: string; files: Array<{ path: string; artifact: string }> }> = [];
	for (const entry of names) {
		let text: string;
		try {
			text = await readFile(join(runs, entry, 'manifest.json'), 'utf8');
		} catch (error) {
			if (planningErrorCode({ error }) === 'ENOENT' || planningErrorCode({ error }) === 'ENOTDIR') continue;
			throw error;
		}
		const run = z
			.object({
				runId: z.string(),
				plan: z.string(),
				overview: z.string().optional(),
				workspace: z.string().optional(),
				pipeline: z.string().optional(),
				steps: z.array(z.object({ id: z.string() })).optional(),
			})
			.parse(JSON.parse(text));
		const runCwd = run.workspace ?? cwd;
		const runWorkspace = planWorkspaceDir({ cwd: runCwd, name });
		const phases =
			run.pipeline === PipelineKind.Phases
				? (run.steps ?? []).filter((step) => /^phase\d+.*\.md$/.test(step.id)).map((step) => join(dirname(run.plan), step.id))
				: [];
		const files: Array<{ path: string; artifact: string }> = [];
		for (const path of new Set([run.plan, ...(run.overview === undefined ? [] : [run.overview]), ...phases])) {
			const local = relative(runWorkspace, resolve(runCwd, path));
			if (isAbsolute(local) || local === '..' || local.startsWith('../')) continue;
			const original = await readFile(resolve(runCwd, path), 'utf8');
			const archive = `planning-originals/${sha256({ content: `${runCwd}:${local}:${sha256({ content: original })}` })}`;
			if (!artifacts.has(archive)) {
				artifacts.set(archive, original);
				record.artifacts.push(planningDataArtifact({ path: archive, content: original }));
			}
			files.push({ path, artifact: archive });
		}
		if (files.length > 0) entries.push({ runId: run.runId, files });
	}
	if (entries.length === 0) return;
	const path = 'planning-legacy-runs.json';
	const content = canonicalJson({ value: { format: 'legacy-run-inputs-v1', entries } });
	artifacts.set(path, content);
	record.artifacts.push(planningDataArtifact({ path, content }));
};
