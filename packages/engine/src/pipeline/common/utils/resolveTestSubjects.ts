import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { collectFolderModules } from '#src/common/moduleGraph/collectFolderModules.ts';
import { collectImportEdges } from '#src/common/moduleGraph/collectImportEdges.ts';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import type { FolderModule } from '#src/common/types/FolderModule.ts';
import type { FrameworkFacts } from '#src/contracts/index.ts';
import { partitionByPackage } from '#src/pipeline/common/utils/partitionByPackage.ts';

// The rule's own definition of public, restated engine-side: a root-layer
// `common/` file is a boundary outright, a file no ancestor module owns has
// no boundary to be promoted through, and an ancestor barrel re-exporting
// the file makes it public.
const isOwnSubject = ({ file, modules }: { file: string; modules: Array<[string, FolderModule]> }) => {
	const segments = file.split('/');

	if (segments.some((segment, index) => segment === 'common' && segments[index - 1] === 'src')) {
		return true;
	}

	const ancestors = modules.filter(([folder]) => file.startsWith(`${folder}/`));

	return ancestors.length === 0 || ancestors.some(([, module]) => module.exportedTargets.has(file));
};

/**
 * One package's walk: its targets resolved against its own module map and
 * import graph. Subjects never cross packages, so every partition answers
 * independently.
 */
const resolvePartition = async ({
	cwd,
	targets,
	universe,
	compiler,
	frameworkFacts,
}: {
	cwd: string;
	targets: string[];
	universe: string[];
	compiler: typeof ts;
	frameworkFacts?: FrameworkFacts;
}) => {
	const modules = [...(await collectFolderModules({ cwd, files: universe, compiler, isFrameworkLoaded: frameworkFacts?.isFrameworkLoadedFile })).entries()];
	const importersOf = new Map<string, string[]>();

	for (const { from, to } of await collectImportEdges({ cwd, files: universe, compiler })) {
		importersOf.set(to, [...(importersOf.get(to) ?? []), from]);
	}

	const contents = new Map<string, string | undefined>();

	const isProvablyInert = async ({ file }: { file: string }) => {
		if (!contents.has(file)) {
			contents.set(file, await readFile(join(cwd, file), 'utf8').catch(() => undefined));
		}

		const content = contents.get(file);

		return content !== undefined && isInertSourceFile({ path: file, content, compiler });
	};

	const subjects = new Map<string, string[]>();
	const orphans: string[] = [];

	for (const target of targets) {
		if (isOwnSubject({ file: target, modules })) {
			subjects.set(target, [target]);
			continue;
		}

		// BFS over reverse edges: an own-subject, non-inert importer is a
		// subject and stops its branch; every other importer (internal, or
		// inert like a barrel) is passed through.
		const found = new Set<string>();
		const visited = new Set<string>([target]);
		const queue = [...(importersOf.get(target) ?? [])].sort();

		for (let index = 0; index < queue.length; index += 1) {
			const importer = queue[index];

			if (importer === undefined || visited.has(importer)) {
				continue;
			}

			visited.add(importer);

			if (isOwnSubject({ file: importer, modules }) && !(await isProvablyInert({ file: importer }))) {
				found.add(importer);
				continue;
			}

			queue.push(...[...(importersOf.get(importer) ?? [])].sort());
		}

		if (found.size === 0) {
			orphans.push(target);
		} else {
			subjects.set(target, [...found].sort());
		}
	}

	return { subjects, orphans };
};

interface Params {
	cwd: string;
	/** Changed testable files (selectTestTargets' targets). */
	targets: string[];
	/** Repo-relative source universe (listSourceFiles output, generated paths excluded). */
	universe: string[];
	/** Monorepo package parent dir (config['packages-dir'] ?? defaultPackagesDir). */
	packagesDir: string;
	/** The consumer's TypeScript, or undefined — without one, every target is its own subject. */
	compiler: typeof ts | undefined;
	/**
	 * The loaded standards pack's answer for this repo. Absent, no file is
	 * framework-loaded and every index file reads as a barrel — today's behavior.
	 */
	frameworkFacts?: FrameworkFacts;
}

/**
 * The upward walk: each changed target file maps to the public files that
 * reach it — the subjects its tests must go through. A target that is its own
 * subject maps to itself; an internal target walks reverse import edges,
 * within its package, until it hits own-subject files; a target nothing
 * public reaches becomes an orphan. A repo that uses no barrels resolves
 * every file to itself — today's per-file behavior, with no config knob.
 *
 * A router root's `index.tsx` is a route rather than a barrel, so route files
 * resolve as their own subjects instead of being walked upward through a barrel
 * that was never there.
 */
export const resolveTestSubjects = async ({
	cwd,
	targets,
	universe,
	packagesDir,
	compiler,
	frameworkFacts,
}: Params): Promise<{ subjects: Map<string, string[]>; orphans: string[] }> => {
	if (!compiler) {
		return { subjects: new Map(targets.map((target) => [target, [target]])), orphans: [] };
	}

	const sourceUniverse = universe.filter((file) => !isTestFile({ path: file }));
	const universeByPackage = partitionByPackage({ files: sourceUniverse, packagesDir });
	const targetsByPackage = partitionByPackage({ files: targets, packagesDir });
	const subjects = new Map<string, string[]>();
	const orphans: string[] = [];

	// Deterministic throughout: partitions in sorted key order, queues seeded
	// sorted, outputs sorted.
	for (const partition of [...targetsByPackage.keys()].sort()) {
		const partitionTargets = [...(targetsByPackage.get(partition) ?? [])].sort();
		// Targets are unioned in: a freshly created file may not have been on
		// disk when the universe was listed, and it must still anchor its edges.
		const partitionUniverse = [...new Set([...(universeByPackage.get(partition) ?? []), ...partitionTargets])].sort();
		const resolved = await resolvePartition({ cwd, targets: partitionTargets, universe: partitionUniverse, compiler, frameworkFacts });

		for (const [target, found] of resolved.subjects) {
			subjects.set(target, found);
		}

		orphans.push(...resolved.orphans);
	}

	return { subjects, orphans };
};
