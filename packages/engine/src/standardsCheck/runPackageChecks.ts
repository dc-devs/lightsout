import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { type StandardsCheckInput, type StandardsCheckRun, type StandardsFinding, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import { buildCheckInput } from '#src/standardsCheck/common/checkInputs/buildCheckInput.ts';
import { typescriptInputKinds } from '#src/standardsCheck/common/constants/typescriptInputKinds.ts';
import type { ResolvedRuleState } from '#src/standardsCheck/common/types/ResolvedRuleState.ts';
import { findFoldersWithoutAliasSource } from '#src/standardsCheck/common/utils/findFoldersWithoutAliasSource.ts';
import { runRuleCheck } from '#src/standardsCheck/common/utils/runRuleCheck.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

/** A rule that will actually run, with everything the run needs already resolved. */
interface LiveRule {
	id: string;
	inputKind: StandardsInputKind;
	run: StandardsCheckRun;
	/** Only the two reporting severities — an `off` rule never becomes a live one. */
	severity: StandardsFinding['severity'];
	settings: Record<string, number>;
}

/**
 * The rules this run executes: the ones that ship a check, are not switched
 * off, and whose document is in play for this repo. Channel gating is
 * all-or-nothing per document — a framework document that does not apply
 * contributes no prose, so it contributes no checks either.
 */
const selectLiveRules = ({
	packages,
	states,
	channels,
}: {
	packages: LoadedStandardsPackage[];
	states: Map<string, ResolvedRuleState>;
	channels: string[];
}) => {
	const live: LiveRule[] = [];

	for (const rule of packages.flatMap((pkg) => pkg.rules)) {
		const state = states.get(rule.id);

		if (rule.run === undefined || rule.inputKind === undefined || state === undefined) {
			continue;
		}

		if (state.severity === StandardsSeverity.Off) {
			continue;
		}

		if (rule.channel !== 'base' && !channels.includes(rule.channel)) {
			continue;
		}

		live.push({ id: rule.id, inputKind: rule.inputKind, run: rule.run, severity: state.severity, settings: state.settings });
	}

	return live;
};

/** Build one rule's input, from the kinds a single shared build can serve and the one that cannot. */
type BuildInput = (params: { kind: StandardsInputKind; settings: Record<string, number> }) => Promise<StandardsCheckInput>;

/**
 * Every live rule's findings, walked one input kind at a time so each kind's
 * expensive build happens once and is handed to every rule that asked for it.
 *
 * A kind needing TypeScript when none resolves does not fail the run — its
 * rules are named as skipped and the rest of the check still reports.
 */
const runLiveRules = async ({
	live,
	buildInput,
	compiler,
	progress,
}: {
	live: LiveRule[];
	buildInput: BuildInput;
	compiler: ReturnType<typeof resolveConsumerTypescript>;
	progress: (message: string) => void;
}) => {
	const findings: StandardsFinding[] = [];
	const skipped: string[] = [];

	for (const kind of Object.values(StandardsInputKind)) {
		const rules = live.filter((rule) => rule.inputKind === kind);

		if (rules.length === 0) {
			continue;
		}

		if (compiler === undefined && typescriptInputKinds.has(kind)) {
			skipped.push(...rules.map((rule) => rule.id));
			continue;
		}

		let shared: StandardsCheckInput | undefined;

		for (const rule of rules) {
			let input: StandardsCheckInput;

			if (kind === StandardsInputKind.CloneSpans) {
				input = await buildInput({ kind, settings: rule.settings });
			} else {
				// Every kind but clone-spans is settings-blind, so one build serves
				// every rule that asked for it.
				shared ??= await buildInput({ kind, settings: rule.settings });
				input = shared;
			}

			const raw = await runRuleCheck({ rule: rule.id, run: rule.run, input, settings: rule.settings });

			findings.push(...raw.map((finding) => ({ ...finding, rule: rule.id, severity: rule.severity })));
		}

		progress(`${kind}: done`);
	}

	return { findings, skipped };
};

interface Params {
	cwd: string;
	packages: LoadedStandardsPackage[];
	states: Map<string, ResolvedRuleState>;
	/** Active framework channels — rules on inactive channels do not run (base always runs). */
	channels: string[];
	/** Monorepo package parent dir (config `packages-dir`), default 'packages'. */
	packagesDir?: string;
	/** Repo-relative subpath to check (default: the whole repo). */
	path?: string;
	/** Path prefixes to exclude (the config's `generated` list). */
	exclude?: string[];
	onProgress?: (message: string) => void;
}

/**
 * Run a standards package's checks over a repo.
 *
 * The engine does all the reading. Rules are grouped by the input they declared
 * and each input is built once from one shared content cache, so a file ten
 * rules care about is opened once — the clone-spans kind excepted, since its
 * detector is driven by the asking rule's own `minTokens` and two rules with
 * different thresholds are two different detections.
 *
 * A rule's id and severity are stamped here rather than inside the check: the
 * id comes from the folder the check was loaded from and the severity from the
 * repo's resolved policy, so a check that could name them itself could also
 * name them wrong.
 *
 * @param channels - the repo's active framework channels
 * @throws {Error} When a check throws or returns something that is not a list of findings — a broken check is a package bug, not a finding.
 */
export const runPackageChecks = async ({
	cwd,
	packages,
	states,
	channels,
	packagesDir = 'packages',
	path,
	exclude,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const progress = onProgress ?? (() => undefined);
	const { files: repoFiles, standardsPackages } = await listSourceFiles({ cwd, exclude });
	const allFiles = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = allFiles.filter((file) => !isTestFile({ path: file, standardsPackages }));
	const tests = allFiles.filter((file) => isTestFile({ path: file, standardsPackages }));
	const notes: string[] = [];

	progress(`checking ${source.length} source file(s) and ${tests.length} test file(s)`);

	const compiler = resolveConsumerTypescript({ cwd, packagesDir });
	const live = selectLiveRules({ packages, states, channels });
	const cache = new Map<string, string>();

	const buildInput: BuildInput = async ({ kind, settings }) =>
		buildCheckInput({ kind, cwd, source, tests, files: allFiles, referenceFiles: repoFiles, standardsPackages, packagesDir, settings, cache, compiler });

	const { findings, skipped } = await runLiveRules({ live, buildInput, compiler, progress });

	if (skipped.length > 0) {
		notes.push(`${skipped.join(', ')} skipped — no typescript resolvable from the target repo`);
	}

	// Asked only when a file-text rule actually ran, since that is the pass whose
	// answer depends on finding an alias declaration. Gated on the rules rather
	// than on whether the cache holds one: a repo that declares aliases nowhere is
	// precisely the case worth reporting, and testing the cache would stay silent
	// about it.
	const uncovered = live.some((rule) => rule.inputKind === StandardsInputKind.FileText)
		? findFoldersWithoutAliasSource({ files: allFiles, contents: cache })
		: [];

	if (uncovered.length > 0) {
		notes.push(
			`no package.json with imports and no tsconfig above ${uncovered.length} folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`,
		);
	}

	return { findings, notes };
};
