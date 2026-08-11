import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';
import { getExportName } from '../../../../common/utils/getExportName.ts';
import { readPathLists } from '../../../../common/utils/readPathLists.ts';

/**
 * Leading verbs that describe how a value is reached rather than what it is
 * about. A domain folder is named for its subject — `formatting/`,
 * `validation/`, `parsing/` — and those names come from verbs that carry a
 * subject with them. These do not: grouping on them yields `predicates/`,
 * `getters/`, `resolution/`, `builders/`, which are folders named for the ROLE
 * of the code they hold — banned outright by this document. Two `is*` functions
 * are two predicates, not a shared domain, so they never graduate.
 */
const accessVerbs = new Set([
	'is',
	'has',
	'can',
	'should',
	'was',
	'get',
	'set',
	'read',
	'write',
	'load',
	'save',
	'fetch',
	'list',
	'collect',
	'gather',
	'to',
	'as',
	'from',
	'with',
	'on',
	'create',
	'make',
	'new',
	'build',
	'init',
	'resolve',
	'find',
	'lookup',
	'run',
	'invoke',
	'call',
	'execute',
	'apply',
]);

/** The leading word of an export name, camelCase boundaries and separators alike. */
const getFirstToken = ({ name }: { name: string }) =>
	name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s\-_.]+/)[0]
		?.toLowerCase() ?? '';

/** Production files under each `utils/` folder, gathered by the verb their names lead with. */
const groupUtilsByVerb = ({ files }: { files: string[] }) => {
	const byDirectory = new Map<string, Map<string, string[]>>();

	for (const file of files) {
		const directory = getDirectory({ path: file });

		if (getBaseName({ path: directory }) === 'utils') {
			const group = byDirectory.get(directory) ?? new Map<string, string[]>();
			const verb = getFirstToken({ name: getExportName({ path: file }) });

			group.set(verb, [...(group.get(verb) ?? []), file]);
			byDirectory.set(directory, group);
		}
	}

	return byDirectory;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Only inside a `utils/` folder: the same repeated verb elsewhere is ordinary
	// domain code that already sits where it belongs. Advisory, because the
	// second function may be one commit away from making the group real.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });
		const testPaths = new Set(tests);
		const findings: RawStandardsFinding[] = [];

		for (const [directory, group] of groupUtilsByVerb({ files: files.filter((file) => !testPaths.has(file)) })) {
			for (const [verb, paths] of group) {
				if (paths.length > 1 && verb !== '' && !accessVerbs.has(verb)) {
					findings.push(
						buildRawFinding({
							rule: 'domain-graduation',
							files: paths.map((path) => ({ path })),
							detail: `${paths.length} '${verb}*' functions in ${directory}`,
							guidance: 'A domain-folder graduation candidate. Heuristic — judge before acting.',
						}),
					);
				}
			}
		}

		return findings;
	},
};
