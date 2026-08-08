import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import { nameOf } from '@/common/naming/nameOf';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { checkFileExports } from '@/standardsCheck/common/utils/checkFileExports';
import { getRuleSettings } from '@/standardsCheck/common/utils/getRuleSettings';

/**
 * Leading verbs that describe how a value is reached rather than what it is
 * about. A domain folder is named for its subject — `formatting/`,
 * `validation/`, `parsing/` — and those names come from verbs that carry a
 * subject with them. These do not: grouping on them yields `predicates/`,
 * `getters/`, `resolution/`, `builders/`, which are folders named for the ROLE
 * of the code they hold — banned outright by folder-structure.md. Two `is*`
 * functions are two predicates, not a shared domain, so they never graduate.
 */
const accessVerbs = new Set([
	'is', 'has', 'can', 'should', 'was',
	'get', 'set', 'read', 'write', 'load', 'save', 'fetch', 'list', 'collect', 'gather',
	'to', 'as', 'from', 'with', 'on',
	'create', 'make', 'new', 'build', 'init',
	'resolve', 'find', 'lookup',
	'run', 'invoke', 'call', 'execute', 'apply',
]);

const firstToken = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s\-_.]+/)[0]?.toLowerCase() ?? '';

/**
 * Deterministic structure lint, four rules over one walk: `multi-export` and
 * `filename-mismatch` per file, `domain-graduation` for utils/ siblings sharing
 * a subject verb, and `folder-census` for a level that has grown into a
 * directory listing. Everything judgment-adjacent is advisory.
 */
export const checkStructure: StandardsPass = async ({ cwd, source, states }) => {
	const findings: StandardsFinding[] = [];
	const filesPerDir = new Map<string, string[]>();
	const utilsVerbGroups = new Map<string, Map<string, string[]>>();

	for (const file of source) {
		const dir = dirname(file);

		filesPerDir.set(dir, [...(filesPerDir.get(dir) ?? []), file]);

		if (basename(dir) === 'utils') {
			const group = utilsVerbGroups.get(dir) ?? new Map<string, string[]>();
			const verb = firstToken(nameOf(file));

			group.set(verb, [...(group.get(verb) ?? []), file]);
			utilsVerbGroups.set(dir, group);
		}

		if (basename(file).startsWith('index.')) {
			continue;
		}

		const text = await readFile(join(cwd, file), 'utf8').catch(() => '');

		findings.push(...checkFileExports({ file, text }));
	}

	for (const [dir, group] of utilsVerbGroups) {
		for (const [verb, paths] of group) {
			if (paths.length > 1 && verb && !accessVerbs.has(verb)) {
				const files = paths.map((path) => ({ path }));

				findings.push(
					buildFinding({
						rule: StandardsRule.DomainGraduation,
						files,
						detail: `${paths.length} '${verb}*' functions in ${dir}`,
						guidance: 'A domain-folder graduation candidate. Heuristic — judge before acting.',
					}),
				);
			}
		}
	}

	const { cap } = getRuleSettings({ states, rule: StandardsRule.FolderCensus });

	for (const [dir, paths] of filesPerDir) {
		if (paths.length > cap) {
			findings.push(
				buildFinding({
					rule: StandardsRule.FolderCensus,
					files: [{ path: dir }],
					detail: `${paths.length} files in one flat folder (census cap ~${cap})`,
					guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
				}),
			);
		}
	}

	return findings;
};
