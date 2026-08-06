import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { nameOf } from '@/common/naming/nameOf';
import { scanFileExports } from '@/scan/common/utils/scanFileExports';

const folderCensusCap = 20;

const firstToken = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s\-_.]+/)[0]?.toLowerCase() ?? '';

interface Params {
	cwd: string;
	/** Repo-relative non-test source files. */
	files: string[];
}

/**
 * Deterministic structure lint: one-export-per-file outside the closed
 * exception list, filename ↔ export-name match (case-insensitively, so
 * framework kebab-case survives), utils/ domain-grouping candidates, and a
 * folder census. Everything judgment-adjacent is advisory.
 */
export const scanStructure = async ({ cwd, files }: Params) => {
	const findings: ScanFinding[] = [];
	const filesPerDir = new Map<string, string[]>();
	const utilsVerbGroups = new Map<string, Map<string, string[]>>();

	for (const file of files) {
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

		findings.push(...scanFileExports({ file, text }));
	}

	for (const [dir, group] of utilsVerbGroups) {
		for (const [verb, paths] of group) {
			if (paths.length > 1 && verb) {
				findings.push({
					detector: ScanDetector.Structure,
					severity: ScanSeverity.Advisory,
					cluster: `domain:${dir}:${verb}`,
					files: paths.map((path) => ({ path })),
					detail: `${paths.length} '${verb}*' functions in ${dir} — domain-folder graduation candidate (heuristic; judge before acting)`,
				});
			}
		}
	}

	for (const [dir, paths] of filesPerDir) {
		if (paths.length > folderCensusCap) {
			findings.push({
				detector: ScanDetector.Structure,
				severity: ScanSeverity.Advisory,
				cluster: `census:${dir}`,
				files: [{ path: dir }],
				detail: `${paths.length} files in one flat folder (census cap ~${folderCensusCap}) — group by domain or graduate concepts`,
			});
		}
	}

	return findings;
};
