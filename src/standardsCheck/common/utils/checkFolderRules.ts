import { basename, dirname } from 'node:path';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import { isTestFile } from '@/common/utils/isTestFile';
import type { FrameworkCarveOut } from '@/standardsCheck/common/types/FrameworkCarveOut';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { collectDirectories } from '@/standardsCheck/common/utils/collectDirectories';

/**
 * folder-structure.md line 35's banned list, upper tier: a folder is never named
 * for the ROLE of the code it holds. These nine are wrong at every level, so
 * `helpers/`, `lib/` and `core/` can never come back as the place for whatever
 * had no home — the failure mode a closed list exists to prevent.
 */
const bannedAnywhere = new Set(['helpers', 'lib', 'core', 'misc', 'shared', 'controllers', 'models', 'hooks', 'components']);

/**
 * The four names line 10 makes `common/`'s own closed vocabulary — its
 * always-built type-folder skeleton.
 *
 * One list serving two rules, because the doc states it once. It is the banned
 * list's lower tier: inside a `common/` these names are mandated, so
 * `path-banned-module-name` bans them only elsewhere, where they are a
 * technical-layer bucket standing in for a domain. And a folder directly under
 * `common/` that is NOT one of them is a graduated domain folder (line 64),
 * which is what `path-domain-folder-single-file` judges — the skeleton itself
 * is never judged.
 */
const commonTypeFolders = new Set(['utils', 'types', 'constants', 'services']);

const camelCase = /^[a-z][A-Za-z0-9]*$/;
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Jest's own mandated folder shape (`__mocks__`, `__tests__`) — a framework doc
 * mandating a name, which is resolution step 2 of the casing rule. Whether such
 * a folder belongs under `src/` at all is a question the test-path rules own.
 */
const frameworkFolder = /^__[A-Za-z0-9]+__$/;

/** A barrel in any source dialect — this group runs at full strength on JS-only repos. */
const barrelName = /^index\.(m|c)?[jt]sx?$/;

/** A path with no owning manifest, and the doc's plain defaults for one that has no framework signal. */
const noCarveOut: FrameworkCarveOut = { exemptFolderNames: [], kebabCase: false, routerRoots: [] };

const casingStyle = ({ segment }: { segment: string }) => {
	if (camelCase.test(segment)) {
		return 'camelCase';
	}

	if (pascalCase.test(segment)) {
		return 'PascalCase';
	}

	if (segment.includes('-')) {
		return 'kebab-case';
	}

	if (segment.includes('_')) {
		return 'snake_case';
	}

	return 'none of the three casings';
};

// `path-banned-module-name`.
const bannedNameFinding = ({ directory, carveOut }: { directory: string; carveOut: FrameworkCarveOut }) => {
	const name = basename(directory);
	const insideCommon = directory.split('/').slice(0, -1).includes('common');
	const banned = bannedAnywhere.has(name) || (commonTypeFolders.has(name) && !insideCommon);

	return !banned || carveOut.exemptFolderNames.includes(name)
		? undefined
		: buildFinding({
				rule: StandardsRule.PathBannedModuleName,
				files: [{ path: directory }],
				detail: `folder '${name}' names the role of the code it holds`,
				guidance:
					'Name the folder for the domain it serves, or fold its files into the module that owns them — the only privileged folder name at any level is `common/`.',
			});
};

// `path-folder-casing`, with the doc's three-step resolution in order: an
// established convention in the directory, then the package's framework doc,
// then the defaults.
const casingFinding = ({
	directory,
	carveOut,
	sourceRoot,
	siblingNames,
}: {
	directory: string;
	carveOut: FrameworkCarveOut;
	sourceRoot: string;
	siblingNames: string[];
}) => {
	const name = basename(directory);
	const style = casingStyle({ segment: name });

	if (style === 'camelCase' || style === 'PascalCase') {
		return undefined;
	}

	// A STRICT majority of the segment's siblings must share its style, and fewer
	// than two siblings is no convention at all — one lone kebab-case folder is
	// precisely the case the rule exists to catch, so "no siblings" must never
	// read as "anything goes".
	const sharing = siblingNames.filter((sibling) => casingStyle({ segment: sibling }) === style);
	const settled = siblingNames.length >= 2 && sharing.length * 2 > siblingNames.length;

	// A router root is matched only DIRECTLY under the package's `src/`: at
	// arbitrary depth an ordinary domain folder called `routes` would exempt its
	// whole subtree.
	const topSegment = directory.slice(sourceRoot.length).replace(/\/.*$/, '');
	const mandated = carveOut.kebabCase || carveOut.routerRoots.includes(topSegment) || frameworkFolder.test(name);

	return settled || mandated
		? undefined
		: buildFinding({
				rule: StandardsRule.PathFolderCasing,
				files: [{ path: directory }],
				detail: `folder '${name}' is ${style}`,
				guidance:
					"Category folders are camelCase; a folder graduated from one class or component takes that item's PascalCase name. An established convention in the directory or the package's framework doc outranks both — heuristic, judge before acting.",
			});
};

// `path-common-barrel` and `path-common-flat`. The barrel rule owns a misplaced
// `index.*` and returns first, so one wrong file is one finding, never two.
const commonShapeFinding = ({ file }: { file: string }) => {
	const parent = dirname(file);
	const name = basename(file);

	if (barrelName.test(name) && parent.split('/').includes('common')) {
		return buildFinding({
			rule: StandardsRule.PathCommonBarrel,
			files: [{ path: file }],
			detail: `a barrel under ${parent}`,
			guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
		});
	}

	return basename(parent) === 'common'
		? buildFinding({
				rule: StandardsRule.PathCommonFlat,
				files: [{ path: file }],
				detail: `'${name}' sits directly in ${parent}`,
				guidance:
					'Move it under the type folder for what it is — `utils/`, `types/`, `constants/`, `services/`, or a graduated domain folder. `common/` is always typed, never flat.',
			})
		: undefined;
};

// `path-domain-folder-single-file`.
const domainFolderFinding = ({ directory, files }: { directory: string; files: string[] }) => {
	const name = basename(directory);

	if (basename(dirname(directory)) !== 'common' || commonTypeFolders.has(name)) {
		return undefined;
	}

	const own = files.filter((file) => dirname(file) === directory && !isTestFile(file));

	return own.length === 1
		? buildFinding({
				rule: StandardsRule.PathDomainFolderSingleFile,
				files: [{ path: directory }],
				detail: `domain folder '${name}' holds one file`,
				guidance: 'A domain folder graduates when a SECOND related function appears — until then the file belongs in `utils/`. Heuristic — judge before acting.',
			})
		: undefined;
};

interface Params {
	/** Every file in scope, repo-relative. */
	files: string[];
	carveOuts: Map<string, FrameworkCarveOut>;
}

/**
 * The five folder rules of folder-structure.md and module-api.md, decided from
 * the file list plus each package's framework carve-outs.
 *
 * `path-banned-module-name` and `path-folder-casing` judge ONLY paths inside a
 * package's `src/` — the repo root's or a workspace package's. Those docs govern
 * the shape of a package's SOURCE tree, while this pass is handed every JS/TS
 * file in the repo; without the anchor a repo's own `tests/helpers/` and fixture
 * trees would report as violations of a rule that never applied to them.
 *
 * A module internal — its behaviour is pinned through `checkPathsAndNames`.
 */
export const checkFolderRules = ({ files, carveOuts }: Params): StandardsFinding[] => {
	// Longest package directory first, so the nearest manifest wins and the repo
	// root (`.`, which matches every path) is only consulted last.
	const packageEntries = [...carveOuts].sort(([first], [second]) => second.length - first.length);

	const contextOf = ({ path }: { path: string }) => {
		const owner = packageEntries.find(([directory]) => directory === '.' || path.startsWith(`${directory}/`));

		if (owner === undefined) {
			return { carveOut: noCarveOut, sourceRoot: 'src/' };
		}

		return { carveOut: owner[1], sourceRoot: owner[0] === '.' ? 'src/' : `${owner[0]}/src/` };
	};

	const directories = [...collectDirectories({ files })].sort();

	// Folder names indexed by their parent once. The casing rule asks for a
	// folder's siblings, and re-scanning the whole list per folder is quadratic
	// in the number of directories — which on a large monorepo is thousands.
	const namesByParent = new Map<string, string[]>();

	for (const directory of directories) {
		const parent = dirname(directory);

		namesByParent.set(parent, [...(namesByParent.get(parent) ?? []), basename(directory)]);
	}

	return [
		...directories.flatMap((directory) => {
			const { carveOut, sourceRoot } = contextOf({ path: directory });

			if (!directory.startsWith(sourceRoot)) {
				return [];
			}

			const name = basename(directory);
			const siblingNames = (namesByParent.get(dirname(directory)) ?? []).filter((sibling) => sibling !== name);

			return [bannedNameFinding({ directory, carveOut }), casingFinding({ directory, carveOut, sourceRoot, siblingNames })];
		}),
		...files.map((file) => commonShapeFinding({ file })),
		...directories.map((directory) => domainFolderFinding({ directory, files })),
	].filter((finding): finding is StandardsFinding => finding !== undefined);
};
