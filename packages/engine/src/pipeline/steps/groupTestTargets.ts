import type ts from 'typescript';
import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { collectImportEdges } from '@/common/utils/collectImportEdges';
import { chunkFileGroup } from '@/pipeline/chunkFileGroup';
import type { TestTargetGroup } from '@/pipeline/common/types/TestTargetGroup';
import { partitionByPackage } from '@/pipeline/common/utils/partitionByPackage';
import { groupConnectedFiles } from '@/pipeline/groupConnectedFiles';
import type { PipelineRun } from '@/pipeline/PipelineRun';

/** Pathological guard: an import component above this splits into sorted chunks — no config knob until live evidence asks for one. */
const maxWriterGroupFiles = 12;

interface Params {
	run: PipelineRun;
	/** resolveTestSubjects output: changed target → its public subjects. */
	subjects: Map<string, string[]>;
	compiler: typeof ts | undefined;
}

/**
 * One writer per import-graph component, not per file: files that changed
 * together AND import each other are one test-writing job — the only
 * grouping that puts a boundary and its internals in the same writer's
 * hands. Connectivity spans the union of the changed targets and their
 * public subjects: the walk's reachability may pass through unchanged
 * intermediaries, so the target→subject mapping itself is an authoritative
 * edge alongside the import edges among the targets. Components never cross
 * packages, so partition by packageOf first. Without a consumer TypeScript,
 * groups degrade to one target each — exactly the old fan-out.
 */
export const groupTestTargets = async ({ run, subjects, compiler }: Params): Promise<TestTargetGroup[]> => {
	const targets = [...subjects.keys()];

	if (!compiler) {
		return targets.map((target) => ({ subjects: subjects.get(target) ?? [target], mustExecute: [target], cluster: target }));
	}

	const byPackage = partitionByPackage({ files: targets, packagesDir: run.config['packages-dir'] ?? defaultPackagesDir });
	const groups: TestTargetGroup[] = [];

	for (const partition of [...byPackage.keys()].sort()) {
		const partitionTargets = byPackage.get(partition) ?? [];
		const targetSet = new Set(partitionTargets);
		const partitionSubjects = partitionTargets.flatMap((target) => subjects.get(target) ?? []);
		const union = [...new Set([...partitionTargets, ...partitionSubjects])];
		const edges = [
			...(await collectImportEdges({ cwd: run.cwd, files: partitionTargets, compiler })),
			...partitionTargets.flatMap((target) =>
				(subjects.get(target) ?? []).filter((subject) => subject !== target).map((subject) => ({ from: target, to: subject })),
			),
		];
		let componentIndex = 0;

		for (const component of groupConnectedFiles({ files: union, edges })) {
			// Every subject rides an edge from a target, so a component always
			// holds at least one target; the guard is belt-and-braces.
			const componentTargets = component.filter((file) => targetSet.has(file));

			if (componentTargets.length === 0) {
				continue;
			}

			const cluster = `${partition}#${componentIndex}`;

			componentIndex += 1;

			if (componentTargets.length > maxWriterGroupFiles) {
				run.progress(
					`write-tests: import component of ${componentTargets.length} files exceeds the ${maxWriterGroupFiles}-file writer cap — splitting into sorted chunks`,
				);
			}

			// Each chunk re-derives its subjects from its own members, so every
			// writer holds the subjects for every file it must execute.
			for (const chunk of chunkFileGroup({ files: componentTargets, max: maxWriterGroupFiles })) {
				groups.push({
					subjects: [...new Set(chunk.flatMap((target) => subjects.get(target) ?? []))].sort(),
					mustExecute: [...chunk].sort(),
					cluster,
				});
			}
		}
	}

	return groups;
};
