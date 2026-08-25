import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type CloneSpansInput, type StandardsCheckFunction, type StandardsCheckInput, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import type { ResolvedRuleState } from '#src/standardsCheck/common/types/ResolvedRuleState.ts';
import { runPackageChecks } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';
import { delegatingSources, duplicatedSources, offsetImportSources, sharedImportSources, writeSampleSources } from '#tests/helpers/duplicationSamples.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

/**
 * A repo holding the given sources, checked by one duplicate-block rule that
 * records the input the run handed it. `typescript` is what decides whether the
 * run can parse the repo: without one, the delegation blanking is skipped
 * rather than guessed.
 */
const setupDuplicationRun = ({ sources, typescript = false }: { sources: Record<string, string>; typescript?: boolean }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-package-checks-duplication-'));
	const inputs: StandardsCheckInput[] = [];
	const run: StandardsCheckFunction = ({ input }) => {
		inputs.push(input);

		return [];
	};

	writeSampleSources({ dir: cwd, sources });

	if (typescript) {
		linkTypescript({ dir: cwd });
	}

	const settings = { minTokens: 50 };
	const rule: LoadedStandardsRule = {
		id: 'duplicate-code-block',
		set: 'code',
		documentPath: 'code/architecture/architecture-decisions',
		summary: 'the same block of code written out in two or more files',
		prose: 'the argument for the rule',
		channel: 'base',
		checked: true,
		defaultSeverity: StandardsSeverity.Advisory,
		defaultSettings: settings,
		fixturesPath: '/packages/acme/duplicate-code-block/fixtures',
		inputKind: StandardsInputKind.CloneSpans,
		run,
	};
	const packs: LoadedStandardsPack[] = [{ name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules: [rule] }];
	const states = new Map<string, ResolvedRuleState>([['duplicate-code-block', { severity: StandardsSeverity.Advisory, settings, fromConfig: false }]]);

	return { cwd, inputs, packs, states };
};

/** The one clone-spans input the run built, narrowed out of the closed kind union. */
const cloneSpansInput = ({ inputs }: { inputs: StandardsCheckInput[] }): CloneSpansInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.CloneSpans) {
		throw new Error(`expected a clone-spans input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

/** The paths the first span names, sorted — the detector decides which site it reports first, which is not the contract. */
const sitesOf = ({ input }: { input: CloneSpansInput }) => (input.spans[0]?.files ?? []).map((file) => file.path).sort();

/** Where the first span starts in one of its two files. */
const startLineOf = ({ input, path }: { input: CloneSpansInput; path: string }) => input.spans[0]?.files.find((file) => file.path === path)?.startLine ?? 0;

describe('runPackageChecks', () => {
	test('hands a duplicate-block rule both sites of a duplicated span and the tokens it spans', async () => {
		const { cwd, inputs, packs, states } = setupDuplicationRun({ sources: duplicatedSources });

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = cloneSpansInput({ inputs });

		// the rule opens no file of its own: the engine runs the detector, so the
		// two sites and the size of the span arrive on the input it was handed
		expect(input.spans).toHaveLength(1);
		expect(sitesOf({ input })).toStrictEqual(['src/alpha.ts', 'src/beta.ts']);
		expect(input.spans[0]?.tokens).toBeGreaterThanOrEqual(50);
	});

	test('reports the line numbers of the file as written, not of the blanked copy the detector read', async () => {
		const { cwd, inputs, packs, states } = setupDuplicationRun({ sources: offsetImportSources });

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = cloneSpansInput({ inputs });
		const alphaLine = startLineOf({ input, path: 'src/alpha.ts' });
		const betaLine = startLineOf({ input, path: 'src/beta.ts' });

		// alpha's body cannot start above line 3, and beta's identical copy sits
		// four lines lower under a four-line-longer import list — the offset only
		// survives if the imports were blanked in place rather than cut out
		expect(alphaLine).toBeGreaterThanOrEqual(3);
		expect(betaLine - alphaLine).toBe(4);
	});

	test('never counts a shared import list as duplication, because nobody can deduplicate one', async () => {
		const { cwd, inputs, packs, states } = setupDuplicationRun({ sources: sharedImportSources });

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = cloneSpansInput({ inputs });

		// on its own the shared list clears the detector's floor, so silence here
		// is the blanking rather than a fixture too small to trip anything
		expect(input.spans).toStrictEqual([]);
	});

	test('blanks the composition remedy out of the detection when the repo has a typescript to parse with', async () => {
		const { cwd, inputs, packs, states } = setupDuplicationRun({ sources: delegatingSources, typescript: true });

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = cloneSpansInput({ inputs });

		// two classes holding the same collaborator repeat the forwarding shape BY
		// DESIGN — the standards mandate it in place of `extends`, so reporting it
		// would hand a refactor agent the remedy as the disease
		expect(input.spans).toStrictEqual([]);
	});

	test('leaves the composition remedy in the detection rather than guessing at it when the repo has no typescript', async () => {
		const { cwd, inputs, packs, states } = setupDuplicationRun({ sources: delegatingSources });

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = cloneSpansInput({ inputs });

		// the blanking needs a parsed tree; without one the run reports what the
		// tokens say rather than pretending to know the shape
		expect(sitesOf({ input })).toStrictEqual(['src/PipelineRun.ts', 'src/RefactorRun.ts']);
	});
});
