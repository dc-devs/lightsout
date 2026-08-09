import { isTestFile } from '@/common/utils/isTestFile';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { StandardsInputKind, StandardsSeverity, type StandardsCheckInput, type StandardsCheckRun, type StandardsFinding } from '@/contracts';
import { buildCheckInput } from '@/standardsCheck/common/checkInputs/buildCheckInput';
import { typescriptInputKinds } from '@/standardsCheck/common/constants/typescriptInputKinds';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';
import { runRuleCheck } from '@/standardsCheck/common/utils/runRuleCheck';
import type { LoadedStandardsPackage } from '@/standardsPackages';

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

interface Params {
	cwd: string;
	packages: LoadedStandardsPackage[];
	states: Map<string, ResolvedRuleState>;
	/** Active framework channels — rules on inactive channels do not run (base always runs). */
	channels: string[];
	/** Monorepo package parent dir (config `packagesDir`), default 'packages'. */
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
	const repoFiles = await listSourceFiles({ cwd, exclude });
	const allFiles = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = allFiles.filter((file) => !isTestFile(file));
	const tests = allFiles.filter((file) => isTestFile(file));
	const notes: string[] = [];

	progress(`checking ${source.length} source file(s) and ${tests.length} test file(s)`);

	const compiler = resolveConsumerTypescript({ cwd, packagesDir });
	const live = selectLiveRules({ packages, states, channels });
	const findings: StandardsFinding[] = [];
	const skipped: string[] = [];
	const cache = new Map<string, string>();

	const inputFor = async ({ kind, settings }: { kind: StandardsInputKind; settings: Record<string, number> }) =>
		buildCheckInput({ kind, cwd, source, tests, files: allFiles, referenceFiles: repoFiles, packagesDir, settings, cache, compiler });

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
			// Every kind but clone-spans is settings-blind, so one build serves
			// every rule that asked for it.
			const input =
				kind === StandardsInputKind.CloneSpans
					? await inputFor({ kind, settings: rule.settings })
					: (shared ??= await inputFor({ kind, settings: rule.settings }));
			const raw = await runRuleCheck({ rule: rule.id, run: rule.run, input, settings: rule.settings });

			findings.push(...raw.map((finding) => ({ ...finding, rule: rule.id, severity: rule.severity })));
		}

		progress(`${kind}: done`);
	}

	if (skipped.length > 0) {
		notes.push(`${skipped.join(', ')} skipped — no typescript resolvable from the target repo`);
	}

	return { findings, notes };
};
