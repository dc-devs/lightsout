import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { collectImportEdges } from '#src/common/moduleGraph/collectImportEdges.ts';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { partitionByPackage } from '#src/pipeline/common/utils/partitionByPackage.ts';

// The standards' own definition of private, restated engine-side: a file
// inside an `internal/` folder belongs to that folder's parent, and every
// other file is public — its own subject.
const isOwnSubject = ({ file }: { file: string }) => !file.split('/').slice(0, -1).includes('internal');

/**
 * One package's walk: its targets resolved against its own module map and
 * import graph. Subjects never cross packages, so every partition answers
 * independently.
 */
const resolvePartition = async ({ cwd, targets, universe, compiler }: { cwd: string; targets: string[]; universe: string[]; compiler: typeof ts }) => {
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
		if (isOwnSubject({ file: target })) {
			subjects.set(target, [target]);
			continue;
		}

		// BFS over reverse edges: an own-subject, non-inert importer is a
		// subject and stops its branch; every other importer (internal, or
		// inert like a package entry that only re-exports) is passed through.
		const found = new Set<string>();
		const visited = new Set<string>([target]);
		const queue = [...(importersOf.get(target) ?? [])].sort();

		for (let index = 0; index < queue.length; index += 1) {
			const importer = queue[index];

			if (importer === undefined || visited.has(importer)) {
				continue;
			}

			visited.add(importer);

			if (isOwnSubject({ file: importer }) && !(await isProvablyInert({ file: importer }))) {
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
}

/**
 * The upward walk: each changed target file maps to the public files that
 * reach it — the subjects its tests must go through. A target that is its own
 * subject maps to itself; a target inside an `internal/` folder walks reverse
 * import edges, within its package, until it hits own-subject files; a target
 * nothing public reaches becomes an orphan. A repo with no `internal/` folders
 * resolves every file to itself — the per-file behavior, with no config knob.
 */
export const resolveTestSubjects = async ({
	cwd,
	targets,
	universe,
	packagesDir,
	compiler,
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
		const resolved = await resolvePartition({ cwd, targets: partitionTargets, universe: partitionUniverse, compiler });

		for (const [target, found] of resolved.subjects) {
			subjects.set(target, found);
		}

		orphans.push(...resolved.orphans);
	}

	return { subjects, orphans };
};
