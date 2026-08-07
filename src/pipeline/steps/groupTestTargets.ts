import type ts from 'typescript';
import { collectImportEdges } from '@/common/utils/collectImportEdges';
import { packageOf } from '@/common/utils/packageOf';
import { chunkFileGroup } from '@/pipeline/chunkFileGroup';
import { groupConnectedFiles } from '@/pipeline/groupConnectedFiles';
import type { PipelineRun } from '@/pipeline/PipelineRun';

/** Pathological guard: an import component above this splits into sorted chunks — no config knob until live evidence asks for one. */
const maxWriterGroupFiles = 12;

interface Params {
	run: PipelineRun;
	targets: string[];
	compiler: typeof ts | undefined;
}

/**
 * One writer per import-graph component, not per file: files that changed
 * together AND import each other are one test-writing job — the only
 * grouping that puts a boundary and its internals in the same writer's
 * hands (so "cover internals through the public surface" is possible on
 * the FIRST pass), while unrelated changes stay parallel. The engine only
 * groups; the agent, holding the injected standards, classifies within.
 * Components never cross packages, so partition by packageOf first.
 * Without a consumer TypeScript, groups degrade to one file each —
 * exactly the old fan-out.
 */
export const groupTestTargets = async ({ run, targets, compiler }: Params): Promise<string[][]> => {
	if (!compiler) {
		return targets.map((file) => [file]);
	}

	const packagesDir = run.config.packagesDir ?? 'packages';
	const byPackage = new Map<string, string[]>();

	for (const file of targets) {
		const key = packageOf({ file, packagesDir }) ?? '';

		byPackage.set(key, [...(byPackage.get(key) ?? []), file]);
	}

	const groups: string[][] = [];

	for (const partition of [...byPackage.keys()].sort()) {
		const partitionFiles = byPackage.get(partition) ?? [];
		const edges = await collectImportEdges({ cwd: run.cwd, files: partitionFiles, compiler });

		for (const component of groupConnectedFiles({ files: partitionFiles, edges })) {
			if (component.length > maxWriterGroupFiles) {
				run.progress(`write-tests: import component of ${component.length} files exceeds the ${maxWriterGroupFiles}-file writer cap — splitting into sorted chunks`);
			}

			groups.push(...chunkFileGroup({ files: component, max: maxWriterGroupFiles }));
		}
	}

	return groups;
};
