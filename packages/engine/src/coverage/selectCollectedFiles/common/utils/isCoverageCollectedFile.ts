import { relative, sep } from 'node:path';
import type { CoverageCollection } from '#src/coverage/selectCollectedFiles/common/types/CoverageCollection.ts';
import { matchesCoverageGlob } from '#src/coverage/selectCollectedFiles/common/utils/matchesCoverageGlob.ts';

const ignoresPath = ({ patterns, rootDir, absolutePath }: { patterns: string[]; rootDir: string; absolutePath: string }) => {
	let ignored = false;

	for (const source of patterns) {
		try {
			// Jest substitutes the token before using the pattern. Left literal,
			// `<rootDir>/src/generated/` compiles as a perfectly valid expression
			// that can never match an absolute path, so the repo's own exclusion
			// would silently do nothing.
			ignored = ignored || new RegExp(source.split('<rootDir>').join(rootDir)).test(absolutePath);
		} catch {
			// a source that will not compile cannot exclude anything
		}
	}

	return ignored;
};

interface Params {
	/** Absolute path to the file, as the coverage report and the ignore patterns both see it. */
	absolutePath: string;
	/** The scope's resolved collection, or undefined when its configuration could not be found or evaluated — which answers `true`, exactly today's behaviour. */
	collection: CoverageCollection | undefined;
}

/**
 * Whether the repo's own coverage configuration collects this file — the
 * question a missing coverage entry cannot answer on its own.
 *
 * Every uncertain answer is `true`. An unreadable configuration, an absent
 * `collectCoverageFrom`, and a glob this matcher does not implement all report
 * the file as collected, so this change can only ever add exemptions and never
 * remove one the gate already enforces.
 */
export const isCoverageCollectedFile = ({ absolutePath, collection }: Params): boolean => {
	if (collection === undefined) {
		return true;
	}

	const path = relative(collection.rootDir, absolutePath).split(sep).join('/');

	// No glob written against this root can reach a file outside it.
	if (path === '' || path.startsWith('../')) {
		return false;
	}

	if (ignoresPath({ patterns: collection.coveragePathIgnorePatterns, rootDir: collection.rootDir, absolutePath })) {
		return false;
	}

	const entries = collection.collectCoverageFrom;

	if (entries === undefined) {
		return true;
	}

	let positive = false;
	let negated = false;
	let undecidable = false;

	for (const entry of entries) {
		const negation = entry.startsWith('!');
		const matched = matchesCoverageGlob({ pattern: negation ? entry.slice(1) : entry, path });

		undecidable = undecidable || matched === undefined;
		positive = positive || (matched === true && !negation);
		negated = negated || (matched === true && negation);
	}

	return undecidable || (positive && !negated);
};
