import { execFileSync } from 'node:child_process';
import { isTestFile } from '../packages/engine/src/common/sourceFiles/isTestFile.ts';

/** The files the chart draws as bars: TypeScript source, minus the unit tests beside it and the declaration files the engine's own walk skips. */
const isBarFile = ({ path }) => /\.tsx?$/.test(path) && !/\.unit\.test\.tsx?$/.test(path) && !path.endsWith('.d.ts');

/** Repo-relative roots of the standards packs in this tree — the folders holding a pack manifest. */
const findPackRoots = ({ paths }) =>
	paths.filter((path) => path.endsWith('/lightsout-standards.json')).map((path) => path.slice(0, path.length - '/lightsout-standards.json'.length));

/**
 * A standards pack's own counter-examples, which this chart must not draw.
 *
 * Inside a pack, `fixtures/fail/` holds code written to break the very rule it
 * proves — the widest folder in this repo is a folder-census fixture, and its
 * longest file is a size-file fixture. `listSourceFiles` prunes them for
 * exactly that reason, so a chart that drew them would report a pack's samples
 * as the repository's own sprawl.
 *
 * That walk reads the working tree and this one reads a commit, so the
 * pruning is stated again here rather than shared —
 * `packages/engine/src/common/sourceFiles/listSourceFiles.ts` is the copy to
 * read alongside this one.
 */
const isPackFixture = ({ path, packRoots }) => packRoots.some((root) => path.startsWith(`${root}/`)) && path.includes('/fixtures/');

/** One commit's tracked files under `packages/`, as `[path, blob oid]` pairs. */
const readTree = ({ repoRoot, sha }) => {
	const output = execFileSync('git', ['ls-tree', '-r', '-z', sha, '--', 'packages'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

	return output
		.split('\0')
		.filter((entry) => entry.length > 0)
		.map((entry) => {
			const [meta, path] = entry.split('\t');

			return [path, meta.split(' ')[2]];
		});
};

/**
 * Line counts for a set of blobs, keyed by object id.
 *
 * Keyed by blob rather than by path, because a file that did not change between
 * two commits is the same object: over three hundred commits of two thousand
 * files that is the difference between reading a few thousand blobs and reading
 * half a million. Batched through one `git cat-file` per chunk rather than one
 * child process per file, for the same reason.
 */
const readBlobLines = ({ repoRoot, oids }) => {
	const counts = new Map();
	const chunkSize = 500;

	for (let start = 0; start < oids.length; start += chunkSize) {
		const chunk = oids.slice(start, start + chunkSize);
		const output = execFileSync('git', ['cat-file', '--batch'], { cwd: repoRoot, input: chunk.join('\n'), maxBuffer: 512 * 1024 * 1024 });
		let cursor = 0;

		for (const oid of chunk) {
			// `<oid> blob <size>\n<contents>\n` — the size is authoritative, so the
			// contents are walked by byte rather than split on newlines.
			const headerEnd = output.indexOf(10, cursor);
			const size = Number(output.toString('utf8', cursor, headerEnd).split(' ')[2]);
			const contentStart = headerEnd + 1;
			let lines = 0;

			for (let at = output.indexOf(10, contentStart); at !== -1 && at < contentStart + size; at = output.indexOf(10, at + 1)) {
				lines += 1;
			}

			counts.set(oid, lines);
			cursor = contentStart + size + 1;
		}
	}

	return counts;
};

/**
 * Every commit's tree, measured: the TypeScript files with their line counts,
 * and every folder's direct-file population.
 *
 * The folder population is counted the way the `crowded-folder` check counts it
 * — non-test files of any type sitting directly in the folder, barrels
 * included, subfolders excluded — so a row the chart draws as over cap is over
 * cap by the repo's own measure rather than by one invented for a drawing.
 *
 * @param repoRoot - the repository to read
 * @param commits - the commits to measure, oldest first
 */
export const readSprawlTrees = ({ repoRoot, commits }) => {
	const trees = commits.map((commit) => {
		const entries = readTree({ repoRoot, sha: commit.sha });
		const packRoots = findPackRoots({ paths: entries.map(([path]) => path) });

		return entries.filter(([path]) => !isPackFixture({ path, packRoots }));
	});
	const barOids = new Set();

	for (const tree of trees) {
		for (const [path, oid] of tree) {
			if (isBarFile({ path })) {
				barOids.add(oid);
			}
		}
	}

	const lineCounts = readBlobLines({ repoRoot, oids: [...barOids] });

	return trees.map((tree) => {
		const packRoots = findPackRoots({ paths: tree.map(([path]) => path) });
		const files = new Map();
		const folders = new Map();

		for (const [path, oid] of tree) {
			if (isBarFile({ path })) {
				files.set(path, lineCounts.get(oid));
			}

			if (!isTestFile({ path, standardsPacks: packRoots })) {
				const directory = path.slice(0, path.lastIndexOf('/'));

				folders.set(directory, (folders.get(directory) ?? 0) + 1);
			}
		}

		return { files, folders };
	});
};
