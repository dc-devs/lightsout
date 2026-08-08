import { basename, dirname } from 'node:path';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { collectDirectories } from '@/standardsCheck/common/utils/collectDirectories';

/**
 * The separate-directory names unit-testing.md line 46 rules out for a unit
 * test. Outside `src/` these very names are the SANCTIONED test-support
 * locations (line 60), which is why every rule here is anchored to `src/`.
 */
const testDirectories = new Set(['__tests__', 'tests', 'test']);

/**
 * The shared test-support folders line 60 places outside `src/`. `__mocks__` is
 * deliberately absent — the same line, and line 138, sanction a co-located one —
 * and so is `helpers`, which `path-banned-module-name` already owns, so one
 * misplaced folder never reports twice.
 */
const testSupportDirectories = new Set(['fixtures', 'mocks', 'testUtils', 'test-utils']);

/**
 * Every source extension a subject may carry. Restricting this to TypeScript
 * would report every co-located test in a JS-only repo as misplaced — and
 * running at full strength on those repos is the whole point of this group.
 */
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

interface FolderModule {
	status: 'module' | 'domainFolder';
	barrelPath: string;
	exportedTargets: Set<string>;
}

const underSrc = ({ path }: { path: string }) => dirname(path).split('/').includes('src');

/** A test file's first name segment — the name of the subject it must sit beside. */
const subjectName = ({ test }: { test: string }) => basename(test).replace(/\..*$/, '');

/**
 * A root-layer `common/` — one whose parent segment is `src`. The doc's
 * classification table calls those files boundaries outright, and they have no
 * barrel to ask by design (there are no barrels under `common/`).
 */
const underRootLayerCommon = ({ path }: { path: string }) => {
	const segments = path.split('/');

	return segments.some((segment, index) => segment === 'common' && segments[index - 1] === 'src');
};

/** The source file a test's first name segment names, in the test's own directory. */
const subjectOf = ({ test, files }: { test: string; files: Set<string> }) => {
	const stem = `${dirname(test)}/${subjectName({ test })}`;

	return sourceExtensions.map((extension) => `${stem}${extension}`).find((candidate) => files.has(candidate));
};

// `path-test-in-tests-folder`.
const inTestsFolderFinding = ({ test }: { test: string }) =>
	dirname(test)
		.split('/')
		.some((segment) => testDirectories.has(segment))
		? buildFinding({
				rule: StandardsRule.PathTestInTestsFolder,
				files: [{ path: test }],
				detail: `a unit test in ${dirname(test)}`,
				guidance: 'Unit tests are co-located with the file they test — move it beside its subject rather than into a separate directory.',
			})
		: undefined;

// `path-test-not-colocated`.
const notColocatedFinding = ({ test, files }: { test: string; files: Set<string> }) =>
	subjectOf({ test, files }) === undefined
		? buildFinding({
				rule: StandardsRule.PathTestNotColocated,
				files: [{ path: test }],
				detail: `no source file named '${subjectName({ test })}' in ${dirname(test)}`,
				guidance:
					'The first name segment must name a real source file in the same folder; a scenario suite qualifies it as `<File>.<scenario>.unit.test.ts` with a camelCase qualifier.',
			})
		: undefined;

// `path-test-support-in-src`, one finding per folder rather than per file.
const supportFolderFindings = ({ files }: { files: string[] }) =>
	[...collectDirectories({ files })]
		.filter((directory) => testSupportDirectories.has(basename(directory)) && underSrc({ path: directory }))
		.sort()
		.map((directory) =>
			buildFinding({
				rule: StandardsRule.PathTestSupportInSrc,
				files: [{ path: directory }],
				detail: `test-support folder '${basename(directory)}' under src/`,
				guidance:
					"Shared helpers, mocks and fixtures live in the package's test-support directories outside `src/` — under `src/` they read as production source to scanners and humans alike. A co-located `__mocks__/` is the one exception.",
			}),
		);

// `path-test-untested-subject-not-public`. Matched on the resolved TARGET path
// rather than the exported name: an aliased re-export still resolves to the same
// file, and an `export *` line carries no names at all.
const subjectNotPublicFinding = ({ test, files, moduleFolders }: { test: string; files: Set<string>; moduleFolders: Array<[string, FolderModule]> }) => {
	const subject = subjectOf({ test, files });

	if (subject === undefined || underRootLayerCommon({ path: subject })) {
		return undefined;
	}

	// No ancestor module means no boundary to be promoted through — the absence
	// of a barrel is not a missing export, so the rule stays silent.
	const ancestors = moduleFolders.filter(([folder]) => subject.startsWith(`${folder}/`));
	const nearest = ancestors[0];

	if (nearest === undefined) {
		return undefined;
	}

	return ancestors.some(([, module]) => module.exportedTargets.has(subject))
		? undefined
		: buildFinding({
				rule: StandardsRule.PathTestUntestedSubjectNotPublic,
				files: [{ path: test }],
				detail: `'${basename(subject)}' is not re-exported from ${nearest[1].barrelPath}`,
				guidance:
					"A direct test is a promotion, not an exception: add the subject to its module's barrel, or drive its coverage through the module's boundary instead. Existing ones are migration debt to leave in place — judge before acting.",
			});
};

interface Params {
	/** Repo-relative test files in scope. */
	tests: string[];
	/** Every file in scope — a co-located test's subject is looked up here. */
	files: string[];
	/** Every module and domain folder with its barrel and the repo-relative paths that barrel re-exports, exactly as `mapFolderModules` returns it. */
	modules: Map<string, FolderModule>;
}

/**
 * The four location rules of standards/tests/unit/jest/unit-testing.md — the
 * half of that document about where a test file sits rather than what it holds.
 *
 * All four are anchored to `src/`: a package's own `tests/` or `test/` directory
 * is a sanctioned test-support location, not a violation of the co-location
 * rule.
 *
 * A module internal — its behaviour is pinned through `checkPathsAndNames`.
 */
export const checkTestPathRules = ({ tests, files, modules }: Params): StandardsFinding[] => {
	const fileSet = new Set(files);
	const inSrc = tests.filter((test) => underSrc({ path: test }));
	// Longest folder first, so a subject's FIRST ancestor here is its nearest
	// owning module — the one whose barrel it would be promoted into.
	const moduleFolders: Array<[string, FolderModule]> = [...modules]
		.filter(([, module]) => module.status === 'module')
		.sort(([first], [second]) => second.length - first.length);

	return [
		...inSrc.map((test) => inTestsFolderFinding({ test })),
		...inSrc.map((test) => notColocatedFinding({ test, files: fileSet })),
		...supportFolderFindings({ files }),
		...inSrc.map((test) => subjectNotPublicFinding({ test, files: fileSet, moduleFolders })),
	].filter((finding): finding is StandardsFinding => finding !== undefined);
};
