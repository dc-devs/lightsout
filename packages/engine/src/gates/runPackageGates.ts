import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import { resolvePackageGatesConfig } from '#src/common/config/resolvePackageGatesConfig.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { readPackageManifest } from '#src/common/workspace/readPackageManifest.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { buildGateEntries } from '#src/gates/common/utils/buildGateEntries.ts';
import { buildGateStages } from '#src/gates/common/utils/buildGateStages.ts';
import { runGateSet } from '#src/gates/runGateSet.ts';
import { appendCommandLog } from '#src/runState/index.ts';

/** A template resolved for this package, or `undefined` when the package has no script for it and the gate was skipped with evidence. */
type ResolveTemplate = (params: { kind: string; template: string }) => Promise<string | undefined>;

/**
 * This stage's entries with their commands resolved for one package, and the
 * ones the package has no script for dropped.
 *
 * Resolution happens after selection, so a gate a held tier never scheduled
 * records no skip. The one substitution is the default schedule's coverage
 * fallback (`coverageFallback`, false under an `exact` schedule): coverage
 * replaces the plain unit suite, so a package with no coverage script still
 * runs its tests from `testTemplate`. What lands in that slot is the `test`
 * entry entire — its family is what `failedFamilies` reports to a fix agent,
 * and its name is what an override would match.
 */
const resolveScopedEntries = async ({
	entries,
	testTemplate,
	resolveTemplate,
	coverageFallback,
}: {
	entries: GateEntry[];
	testTemplate: string;
	resolveTemplate: ResolveTemplate;
	coverageFallback: boolean;
}) => {
	const scheduledTest = entries.some((entry) => entry.name === 'test');
	const resolved: GateEntry[] = [];

	for (const entry of entries) {
		const command = await resolveTemplate({ kind: entry.family, template: entry.command });

		if (command !== undefined) {
			resolved.push({ ...entry, command });
		} else if (coverageFallback && entry.name === 'test-coverage' && !scheduledTest) {
			const fallback = await resolveTemplate({ kind: 'test', template: testTemplate });

			if (fallback !== undefined) {
				resolved.push({ family: 'test', name: 'test', command: fallback });
			}
		}
	}

	return resolved;
};

interface Params {
	cwd: string;
	packagesDir: string;
	/** Directory name under packagesDir — also the group label in the evidence. */
	packageDir: string;
	/** The `{package}` command templates from config `package-gates`. */
	scoped: NonNullable<LightsoutConfig['package-gates']>;
	/** Also run the scoped coverage gate, when the config defines one. */
	coverage?: boolean;
	/** How this run's gates are scheduled, passed through from `runGates` — the one place the default is chosen. */
	schedule: GateSchedule;
	/** Which stage of that schedule to run — the index `runGates` is holding every group at. */
	stage: number;
	gate: RunGate;
	failFast?: boolean;
	runId?: string;
	step?: string;
	onGateResult?: (result: GateResult) => void;
	onProgress?: (message: string) => void;
}

/**
 * One stage of one package's scoped gate group. A scoped template fans out to
 * every package in scope, including ones the consumer never hand-tuned (infra,
 * docs), so a package with no matching script is skipped with evidence — never
 * failed, and never silently passed. Detection is convention-based: the script
 * name after the template's `run` token; a template with no `run` token always
 * executes.
 *
 * It is called once per stage rather than once per package because a group
 * cannot wait for its siblings from inside itself: `runGates` runs stage 0
 * across every package before any package starts stage 1, which is what holds
 * the expensive tier until every package's cheap gates are green.
 *
 * Returns the stage's aggregate result. An unresolvable package.json is the
 * reserved `package-manifest` family, so one bad package never takes down the
 * fan-out.
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
	schedule,
	stage,
	gate,
	failFast,
	runId,
	step,
	onGateResult,
	onProgress,
}: Params): Promise<GateRunResult> => {
	let manifest: Awaited<ReturnType<typeof readPackageManifest>>;

	try {
		manifest = await readPackageManifest({ cwd, packagesDir, packageDir });
	} catch (error) {
		return { error: messageOf({ error }), failedFamilies: ['package-manifest'], crashes: [] };
	}

	const templates = resolvePackageGatesConfig({ packageGates: scoped });
	const substitute = ({ command }: { command: string }) => command.split('{package}').join(manifest.name);

	const resolveTemplate: ResolveTemplate = async ({ kind, template }) => {
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

	// The scoped block is already read into the engine's spelling, which is the
	// shape entries are built from — restating it field by field here would be
	// the same mapping written twice.
	const entries = buildGateEntries({ commands: templates });
	const scheduled = buildGateStages({ entries, schedule, coverage })[stage] ?? [];

	return runGateSet({
		label: packageDir,
		gate,
		failFast,
		entries: await resolveScopedEntries({
			entries: scheduled,
			testTemplate: templates.test,
			resolveTemplate,
			coverageFallback: schedule.kind !== GateScheduleKind.Exact,
		}),
	});
};
