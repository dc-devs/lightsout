import type { FileListInput, StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

interface Params extends Partial<Omit<FileListInput, 'kind' | 'dependencies'>> {
	dependencies?: Array<[string, string[]]>;
}

/**
 * The input a `file-list` check receives, built in memory.
 *
 * `files`, `source` and `tests` say overlapping things — every path, the source
 * paths, the test paths — so a test states whichever it means and the rest
 * follow. Give `files` and it is taken as the source; give `source` and `tests`
 * and `files` becomes both together. Both readings appeared among the
 * hand-rolled copies of this factory, and both are right for the test that
 * chose them.
 *
 * `dependencies` is written as pairs rather than as a `Map`, matching how the
 * other factories take `contents` and `sources`. A test states data; building
 * the collection is this function's job.
 *
 * @param dependencies - declared dependency names per package directory, as pairs — `'.'` is the repo root
 */
export const setupFileListInput = ({ files, source, tests = [], dependencies = [], ...overrides }: Params = {}): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: source ?? files ?? [],
	tests,
	files: files ?? [...(source ?? []), ...tests],
	referenceFiles: [],
	dependencies: new Map(dependencies),
	standardsPacks: [],
	...overrides,
});
