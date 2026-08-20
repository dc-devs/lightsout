import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { collectDirectories } from '../../../../common/utils/collectDirectories.ts';
import { getBaseName } from '../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';
import { getFrameworkCarveOuts } from '../../../../common/utils/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../common/utils/getPathCarveOut.ts';
import { getSourceRoot } from '../../../../common/utils/getSourceRoot.ts';
import { isUnderRouterRoot } from '../../../../common/utils/isUnderRouterRoot.ts';
import { readPathLists } from '../../../../common/utils/readPathLists.ts';

const camelCase = /^[a-z][A-Za-z0-9]*$/;
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Jest's own mandated folder shape (`__mocks__`, `__tests__`) — a framework doc
 * mandating a name, which is resolution step 2 of the casing rule. Whether such
 * a folder belongs under `src/` at all is a question the test-path rules own.
 */
const frameworkFolder = /^__[A-Za-z0-9]+__$/;

const getCasingStyle = ({ segment }: { segment: string }) => {
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

/**
 * Folder names indexed by their parent. The rule asks for a folder's siblings,
 * and re-scanning the whole list per folder is quadratic in the number of
 * directories — which on a large monorepo is thousands.
 */
const groupNamesByParent = ({ directories }: { directories: string[] }) => {
	const namesByParent = new Map<string, string[]>();

	for (const directory of directories) {
		const parent = getDirectory({ path: directory });

		namesByParent.set(parent, [...(namesByParent.get(parent) ?? []), getBaseName({ path: directory })]);
	}

	return namesByParent;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// The doc's three-step resolution, in order: an established convention in the
	// directory, then the package's framework doc, then the defaults. Two of the
	// three steps are judgment, which is why the rule is advisory.
	run: ({ input }): RawStandardsFinding[] => {
		const { files } = readPathLists({ input });
		const carveOuts = getFrameworkCarveOuts({ dependencies: input.kind === 'file-list' ? input.dependencies : new Map<string, string[]>() });
		const directories = [...collectDirectories({ files })].sort();
		const namesByParent = groupNamesByParent({ directories });
		const findings: RawStandardsFinding[] = [];

		for (const directory of directories) {
			const carveOut = getPathCarveOut({ carveOuts, path: directory });
			const sourceRoot = getSourceRoot({ carveOut });
			const name = getBaseName({ path: directory });
			const style = getCasingStyle({ segment: name });

			if (!directory.startsWith(sourceRoot) || style === 'camelCase' || style === 'PascalCase') {
				continue;
			}

			// A STRICT majority of the segment's siblings must share its style, and
			// fewer than two siblings is no convention at all — one lone kebab-case
			// folder is precisely the case the rule exists to catch, so "no siblings"
			// must never read as "anything goes".
			const siblingNames = (namesByParent.get(getDirectory({ path: directory })) ?? []).filter((sibling) => sibling !== name);
			const sharing = siblingNames.filter((sibling) => getCasingStyle({ segment: sibling }) === style);
			const settled = siblingNames.length >= 2 && sharing.length * 2 > siblingNames.length;

			const mandated = carveOut.kebabCase || isUnderRouterRoot({ path: directory, carveOut }) || frameworkFolder.test(name);

			if (!settled && !mandated) {
				findings.push(
					buildRawFinding({
						rule: 'path-folder-casing',
						files: [{ path: directory }],
						detail: `folder '${name}' is ${style}`,
						guidance:
							"Category folders are camelCase; a folder graduated from one class or component takes that item's PascalCase name. An established convention in the directory or the package's framework doc outranks both — heuristic, judge before acting.",
					}),
				);
			}
		}

		return findings;
	},
};
