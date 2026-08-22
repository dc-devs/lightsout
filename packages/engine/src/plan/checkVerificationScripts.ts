import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { getManifestScriptKeys } from '#src/plan/common/utils/getManifestScriptKeys.ts';
import { getPlanNamedPaths } from '#src/plan/common/utils/getPlanNamedPaths.ts';

interface Params {
	plan: ParsedPlan;
	cwd: string;
	/** Absolute path to the plan file — its basename anchors each finding's location. */
	planPath: string;
	/** The finding label: this file's basename. */
	phase: string;
	/** Directory prefix each package lives under (`packages` by default). */
	packagesDir: string;
	/** Full-command verification overrides from config — never checked as package scripts. */
	configCommands: Set<string>;
	/** Script names an earlier-or-same phase declares it adds — available even though no package.json has them yet. */
	declaredScripts: Set<string>;
}

/** The package-script name a verification command invokes, or undefined for a raw command with no package-manager prefix. */
const scriptNameOf = ({ command }: { command: string }) => {
	// Any `… run <script>` form (pnpm/npm/yarn/turbo, with or without filter
	// flags) resolves through the same parser the doctor and scoped gates use,
	// so the three can never disagree about which script a command invokes.
	let scriptName = extractRunScriptName({ command });
	const tokens = command.split(/\s+/);

	if (scriptName === undefined && tokens[0] === 'pnpm') {
		// Bare-script form (`pnpm check`, `pnpm --filter x check`, `pnpm -F x
		// check`): the script is the first token past the flags. `--filter`/`-F`
		// consume their selector argument; `--filter=<sel>` is a single token.
		let index = 1;

		while (tokens[index]?.startsWith('-')) {
			index += tokens[index] === '--filter' || tokens[index] === '-F' ? 2 : 1;
		}

		scriptName = tokens[index];
	}

	if (scriptName === undefined && tokens[0] === 'yarn' && tokens[1] !== undefined && !tokens[1].startsWith('-')) {
		scriptName = tokens[1];
	}

	return scriptName;
};

/** Each package directory the plan names a path inside — every manifest beyond the root one whose scripts this plan's commands may resolve in. */
const getPackageDirs = ({ plan, packagesDir }: { plan: ParsedPlan; packagesDir: string }) => {
	const packageDirs = new Set<string>();

	for (const path of getPlanNamedPaths({ plan, includeMirrors: true })) {
		if (path.startsWith(`${packagesDir}/`)) {
			const segment = path.slice(packagesDir.length + 1).split('/')[0];

			if (segment) {
				packageDirs.add(segment);
			}
		}
	}

	return packageDirs;
};

/** Every script key the root manifest and each named package's manifest declare — an unreadable manifest contributes nothing rather than failing the check. */
const getAvailableScripts = async ({ cwd, packagesDir, packageDirs }: { cwd: string; packagesDir: string; packageDirs: Set<string> }) => {
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

	return availableScripts;
};

/**
 * ScriptExists — each verification command's package script must resolve in a
 * target package.json (root plus each package any path the plan names sits in —
 * created, modified, moved or deleted, so a phase whose only package-touching
 * work is a move still resolves that package's manifest). Config full-command
 * overrides, scripts an earlier-or-same phase declares it adds, and raw
 * non-package commands are skipped, never guessed into findings.
 */
export const checkVerificationScripts = async ({
	plan,
	cwd,
	planPath,
	phase,
	packagesDir,
	configCommands,
	declaredScripts,
}: Params): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];
	const availableScripts = await getAvailableScripts({ cwd, packagesDir, packageDirs: getPackageDirs({ plan, packagesDir }) });

	for (const command of plan.verificationCommands) {
		if (configCommands.has(command)) {
			continue;
		}

		const scriptName = scriptNameOf({ command });

		// A raw command with no package-manager prefix (e.g. `tsc --noEmit`) is
		// not a package script — do not guess it into a finding.
		if (scriptName === undefined) {
			continue;
		}

		if (!availableScripts.has(scriptName) && !declaredScripts.has(scriptName)) {
			findings.push({
				check: StructuralCheck.ScriptExists,
				severity: FindingSeverity.Blocking,
				phase,
				issue: `verification command '${command}' references package script '${scriptName}' which is not in any target package.json`,
				location: `${basename(planPath)} → Verification`,
				fix: `use a script that exists, or add '${scriptName}' to the package.json`,
			});
		}
	}

	return findings;
};
