import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { extractRunScriptName } from '@/common/utils/extractRunScriptName';
import { StructuralCheck, type StructuralFinding } from '@/contracts';
import type { ParsedPlan } from '@/plan/common/types/ParsedPlan';
import { getManifestScriptKeys } from '@/plan/common/utils/getManifestScriptKeys';

interface Params {
	plan: ParsedPlan;
	cwd: string;
	/** Absolute path to the plan file — its basename anchors each finding's location. */
	planPath: string;
	/** Directory prefix each package lives under (`packages` by default). */
	packagesDir: string;
	/** Full-command verification overrides from config — never checked as package scripts. */
	configCommands: Set<string>;
}

/** The package-script name a verification command invokes, or undefined for a raw command with no package-manager prefix. */
const scriptNameOf = (command: string): string | undefined => {
	// Any `… run <script>` form (pnpm/npm/yarn/turbo, with or without filter
	// flags) resolves through the same parser the doctor and scoped gates use,
	// so the three can never disagree about which script a command invokes.
	const runScript = extractRunScriptName({ command });

	if (runScript !== undefined) {
		return runScript;
	}

	const tokens = command.split(/\s+/);

	if (tokens[0] === 'pnpm') {
		// Bare-script form (`pnpm check`, `pnpm --filter x check`, `pnpm -F x
		// check`): the script is the first token past the flags. `--filter`/`-F`
		// consume their selector argument; `--filter=<sel>` is a single token.
		let index = 1;

		while (tokens[index]?.startsWith('-')) {
			index += tokens[index] === '--filter' || tokens[index] === '-F' ? 2 : 1;
		}

		return tokens[index];
	}

	if (tokens[0] === 'yarn' && tokens[1] !== undefined && !tokens[1].startsWith('-')) {
		return tokens[1];
	}

	return undefined;
};

/**
 * ScriptExists — each verification command's package script must resolve in a
 * target package.json (root plus each package a create/modify/mirror path
 * names). Config full-command overrides and raw non-package commands are
 * skipped, never guessed into findings.
 */
export const checkVerificationScripts = async ({ plan, cwd, planPath, packagesDir, configCommands }: Params): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];
	const packageDirs = new Set<string>();

	for (const path of [...plan.createPaths, ...plan.modifyPaths, ...plan.mirrorPaths]) {
		if (path.startsWith(`${packagesDir}/`)) {
			const segment = path.slice(packagesDir.length + 1).split('/')[0];

			if (segment) {
				packageDirs.add(segment);
			}
		}
	}

	const manifestPaths = [join(cwd, 'package.json'), ...[...packageDirs].map((dir) => join(cwd, packagesDir, dir, 'package.json'))];
	const availableScripts = new Set<string>();

	for (const manifestPath of manifestPaths) {
		const raw = await readFile(manifestPath, 'utf8').catch(() => undefined);

		if (!raw) {
			continue;
		}

		for (const key of getManifestScriptKeys({ raw })) {
			availableScripts.add(key);
		}
	}

	for (const command of plan.verificationCommands) {
		if (configCommands.has(command)) {
			continue;
		}

		const scriptName = scriptNameOf(command);

		// A raw command with no package-manager prefix (e.g. `tsc --noEmit`) is
		// not a package script — do not guess it into a finding.
		if (scriptName === undefined) {
			continue;
		}

		if (!availableScripts.has(scriptName)) {
			findings.push({
				check: StructuralCheck.ScriptExists,
				issue: `verification command '${command}' references package script '${scriptName}' which is not in any target package.json`,
				location: `${basename(planPath)} → Verification`,
				fix: `use a script that exists, or add '${scriptName}' to the package.json`,
			});
		}
	}

	return findings;
};
