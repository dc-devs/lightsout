import { StandardsRule, type StandardsFinding } from '@/contracts';
import { isTestFile } from '@/common/utils/isTestFile';
import { readFileContents } from '@/standardsCheck/common/utils/readFileContents';
import { mapFolderModules } from '@/standardsCheck/mapFolderModules';
import { readBarrelExports } from '@/standardsCheck/readBarrelExports';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';

/**
 * Barrel hygiene over every internal (non-root) barrel, two rules: `barrel-star`
 * for an `export *` line — barrels must be named re-exports — and
 * `barrel-dead-entry` for a named entry of a `module`-status barrel that NO file
 * outside the module references, by whole-word reference counting exactly like
 * checkDeadExports (short names skipped, conservative by construction). Every
 * unconsumed entry of one barrel is ONE finding: the work is a single pass over
 * that barrel's surface. Package-root barrels are excluded from both rules
 * (their consumers are other packages, invisible to path resolution).
 * Text-based throughout — needs no compiler, so unlike the compiler-gated
 * passes it runs even in JS-only repos.
 */
export const checkBarrelHygiene: StandardsPass = async ({ cwd, files, referenceFiles }) => {
	const modules = await mapFolderModules({ cwd, files });
	const contents = await readFileContents({ cwd, files: [...files, ...referenceFiles] });

	const findings: StandardsFinding[] = [];

	for (const [folder, entry] of modules) {
		const barrelExports = readBarrelExports({ barrelPath: entry.barrelPath, text: contents.get(entry.barrelPath) ?? '', files });
		const stars = barrelExports.filter((line) => line.star);

		if (stars.length > 0) {
			findings.push(
				buildFinding({
					rule: StandardsRule.BarrelStar,
					files: [{ path: entry.barrelPath }],
					detail: `${stars.map((line) => `'${line.specifier}'`).join(', ')} re-exported with \`export *\``,
					guidance: 'A barrel is a module’s public API — list named re-exports instead.',
				}),
			);
		}

		if (entry.status !== 'module') {
			continue;
		}

		const prefix = `${folder}/`;
		const orphans: string[] = [];

		for (const name of barrelExports.flatMap((line) => line.names)) {
			if (name.length < 4) {
				continue;
			}

			const pattern = new RegExp(`\\b${name}\\b`);
			// A test file is a CLIENT of the public surface wherever it sits —
			// a co-located test inside the module still counts as consumption.
			const consumedOutside = [...contents].some(
				([file, text]) => (!file.startsWith(prefix) || (isTestFile(file) && file !== entry.barrelPath)) && pattern.test(text),
			);

			if (!consumedOutside) {
				orphans.push(name);
			}
		}

		if (orphans.length > 0) {
			findings.push(
				buildFinding({
					rule: StandardsRule.BarrelDeadEntry,
					files: [{ path: entry.barrelPath }],
					detail: `${orphans.map((name) => `'${name}'`).join(', ')} ${orphans.length > 1 ? 'are' : 'is'} exported from ${entry.barrelPath} but no file outside module '${folder}' consumes ${orphans.length > 1 ? 'them' : 'it'}`,
					guidance: 'Deliberate public API, or dead? Only the author knows.',
				}),
			);
		}
	}

	return findings;
};
