import { extractRunScriptName } from '#src/common/utils/extractRunScriptName.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { resolvePackageGatesConfig } from '#src/common/utils/resolvePackageGatesConfig.ts';
import { resolvePackageManifest } from '#src/common/utils/resolvePackageManifest.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import type { GateCommands } from '#src/pipeline/common/types/GateCommands.ts';
import type { RunGate } from '#src/pipeline/common/types/RunGate.ts';
import { runGateSet } from '#src/pipeline/runGateSet.ts';
import { appendCommandLog } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	packagesDir: string;
	/** Directory name under packagesDir — also the group label in the evidence. */
	packageDir: string;
	/** The `{package}` command templates from config `package-gates`. */
	scoped: NonNullable<LightsoutConfig['package-gates']>;
	/** Also run the scoped coverage gate, when the config defines one. */
	coverage?: boolean;
	gate: RunGate;
	failFast?: boolean;
	runId?: string;
	step?: string;
	onGateResult?: (result: GateResult) => void;
	onProgress?: (message: string) => void;
}

/**
 * One package's scoped gate group. A scoped template fans out to every package
 * in scope, including ones the consumer never hand-tuned (infra, docs), so a
 * package with no matching script is skipped with evidence — never failed, and
 * never silently passed. Detection is convention-based: the script name after
 * the template's `run` token; a template with no `run` token always executes.
 *
 * Returns the group's aggregated failure text, or undefined when green — an
 * unresolvable package.json is itself a failure string, so one bad package
 * never takes down the fan-out.
 *
 * Split out of `runGates` so that function is left dispatching between the root
 * and scoped groups; everything here is monorepo-only and does not touch the
 * single-package path. A module internal; its behaviour is pinned through
 * `runGates`' own scoped-skip tests.
 */
export const runPackageGates = async ({
	cwd,
	packagesDir,
	packageDir,
	scoped,
	coverage,
	gate,
	failFast,
	runId,
	step,
	onGateResult,
	onProgress,
}: Params): Promise<string | undefined> => {
	let manifest: Awaited<ReturnType<typeof resolvePackageManifest>>;

	try {
		manifest = await resolvePackageManifest({ cwd, packagesDir, packageDir });
	} catch (error) {
		return messageOf({ error });
	}

	const templates = resolvePackageGatesConfig({ packageGates: scoped });
	const substitute = ({ command }: { command: string }) => command.split('{package}').join(manifest.name);

	const scopedCommand = async ({ kind, template }: { kind: string; template: string }) => {
		const scriptName = extractRunScriptName({ command: template });

		if (!scriptName || Object.hasOwn(manifest.scripts, scriptName)) {
			return substitute({ command: template });
		}

		onProgress?.(`gate [${packageDir}] ${kind}: skipped (no "${scriptName}" script)`);

		if (runId) {
			await appendCommandLog({
				cwd,
				runId,
				record: {
					at: new Date().toISOString(),
					step,
					group: packageDir,
					kind,
					command: substitute({ command: template }),
					skipped: true,
					reason: `no "${scriptName}" script`,
				},
			});
		}

		onGateResult?.({ kind, group: packageDir, command: substitute({ command: template }), skipped: true, reason: `no "${scriptName}" script` });

		return undefined;
	};

	const testCoverage = coverage && templates.testCoverage ? await scopedCommand({ kind: 'testCoverage', template: templates.testCoverage }) : undefined;
	const extraTests: GateCommands['extraTests'] = [];

	for (const { name, command } of templates.extraTests) {
		extraTests.push({ name, command: await scopedCommand({ kind: name, template: command }) });
	}

	return runGateSet({
		label: packageDir,
		gate,
		failFast,
		commands: {
			check: await scopedCommand({ kind: 'check', template: templates.check }),
			// Coverage replaces the plain test run; only when coverage is
			// absent or skipped does test get its own script lookup.
			test: testCoverage ? undefined : await scopedCommand({ kind: 'test', template: templates.test }),
			testCoverage,
			extraTests,
			build: templates.build ? await scopedCommand({ kind: 'build', template: templates.build }) : undefined,
		},
	});
};
