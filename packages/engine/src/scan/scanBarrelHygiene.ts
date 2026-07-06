import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';
import { mapFolderModules } from './mapFolderModules';
import { readBarrelExports } from './readBarrelExports';

interface Params {
	cwd: string;
	/** Repo-relative source files — the universe of barrels to check. */
	files: string[];
	/** Files searched for outside references — the whole repo, so an entry consumed beyond a scoped path is not called dead. */
	referenceFiles?: string[];
}

/**
 * Barrel-hygiene detector over every internal (non-root) barrel: (1) an
 * `export *` line is a Finding — barrels must be named re-exports; (2) a named
 * entry of a `module`-status barrel that NO file outside the module references
 * — via the barrel or otherwise — is an Advisory, "deliberate public API, or
 * dead?", by whole-word reference counting exactly like scanDeadExports
 * (short names skipped, conservative by construction). Package-root barrels
 * are excluded from both checks (their consumers are other packages, invisible
 * to path resolution). Runs in the compiler-gated block with the other
 * architecture detectors.
 */
export const scanBarrelHygiene = async ({ cwd, files, referenceFiles }: Params): Promise<ScanFinding[]> => {
	const modules = await mapFolderModules({ cwd, files });
	const contents = new Map<string, string>();

	for (const file of new Set([...files, ...(referenceFiles ?? [])])) {
		contents.set(file, (await readFile(join(cwd, file), 'utf8').catch(() => '')) ?? '');
	}

	const findings: ScanFinding[] = [];

	for (const [folder, entry] of modules) {
		const barrelExports = readBarrelExports({ barrelPath: entry.barrelPath, text: contents.get(entry.barrelPath) ?? '', files });
		const stars = barrelExports.filter((line) => line.star);

		if (stars.length > 0) {
			findings.push({
				detector: ScanDetector.BarrelHygiene,
				severity: ScanSeverity.Finding,
				cluster: `barrel-star:${entry.barrelPath}`,
				files: [{ path: entry.barrelPath }],
				detail: `${stars.map((line) => `'${line.specifier}'`).join(', ')} re-exported with \`export *\` — a barrel is its public API; list named re-exports instead`,
			});
		}

		if (entry.status !== 'module') {
			continue;
		}

		const prefix = `${folder}/`;

		for (const name of barrelExports.flatMap((line) => line.names)) {
			if (name.length < 4) {
				continue;
			}

			const pattern = new RegExp(`\\b${name}\\b`);
			const consumedOutside = [...contents].some(([file, text]) => !file.startsWith(prefix) && pattern.test(text));

			if (!consumedOutside) {
				findings.push({
					detector: ScanDetector.BarrelHygiene,
					severity: ScanSeverity.Advisory,
					cluster: `barrel-dead:${entry.barrelPath}:${name}`,
					files: [{ path: entry.barrelPath }],
					detail: `'${name}' is exported from ${entry.barrelPath} but no file outside module '${folder}' consumes it — deliberate public API, or dead?`,
				});
			}
		}
	}

	return findings;
};
