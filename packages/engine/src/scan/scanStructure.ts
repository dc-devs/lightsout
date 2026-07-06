import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';

const folderCensusCap = 20;
const exportPattern = /^export\s+(?:async\s+)?(const|class|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/;

const nameOf = (path: string) => basename(path).replace(/\.(m|c)?[jt]sx?$/, '');
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** 'session-response.model' → ['session-response.model', 'session-response'] — framework dot-suffixes (.model/.dto/.entity/…) are convention, not a mismatch. */
const dotPrefixes = (name: string) => name.split('.').map((_, index, segments) => segments.slice(0, index + 1).join('.'));
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
		const exports: Array<{ keyword: string; name: string; line: string }> = [];

		for (const line of text.split('\n')) {
			const match = line.match(exportPattern);

			if (match?.[1] && match[2]) {
				exports.push({ keyword: match[1], name: match[2], line });
			}
		}

		if (exports.length === 0) {
			continue;
		}

		// Closed exceptions to one-export-per-file:
		// - named constant: `const X` + `type X` sharing one name, plus any
		//   lookup-map consts typed `Record<X, …>` (exception 4)
		// - union family: interfaces + exactly one `type` alias (exception 3)
		const keywords = (keyword: string) => exports.filter((entry) => entry.keyword === keyword);
		const constTypeName = keywords('const').find(({ name }) => keywords('type').some((entry) => entry.name === name))?.name;
		const namedConstantFamily =
			constTypeName !== undefined &&
			exports.every(
				({ keyword, name, line }) =>
					name === constTypeName || (keyword === 'const' && line.includes(`Record<${constTypeName}`)),
			);
		const unionFamily = keywords('interface').length > 0 && keywords('type').length === 1 && keywords('interface').length + 1 === exports.length;

		if (exports.length > 1 && !namedConstantFamily && !unionFamily) {
			findings.push({
				detector: ScanDetector.Structure,
				severity: ScanSeverity.Finding,
				cluster: `multi-export:${file}`,
				files: [{ path: file }],
				detail: `${exports.length} exports (${exports.map(({ name }) => name).join(', ')}) — one export per file outside the closed exception list`,
			});
		}

		const primary = exports[0];

		if (primary && exports.length === 1 && !dotPrefixes(nameOf(file)).some((candidate) => normalized(candidate) === normalized(primary.name))) {
			findings.push({
				detector: ScanDetector.Structure,
				severity: ScanSeverity.Advisory,
				cluster: `filename-mismatch:${file}`,
				files: [{ path: file }],
				detail: `file '${nameOf(file)}' exports '${primary.name}' — the filename should match the export`,
			});
		}
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
