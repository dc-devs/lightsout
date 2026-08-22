import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The run's changed files the standards may judge: source this repo owns,
 * tests included.
 *
 * Tests are the whole reason this exists beside `sourceFiles`. That one answers
 * "which files earn an agent turn" and drops tests, which is right for choosing
 * test subjects and for a refactor review list. The standards gate asks a
 * different question — "which files may a finding be about" — and the bundled
 * standards carry 26 unit-testing rules, 17 of them machine-checked. Scoping
 * the gate with the agent-attention list made every finding whose only file is
 * a test file unmatchable, so a rule like `test-mock-untyped` was blocking by
 * declaration and unenforceable in practice.
 *
 * Vendored paths stay excluded here for the same reason they are everywhere
 * else: their conventions are not this repo's, so a finding about one is not
 * this repo's to answer.
 */
export const standardsScopeFiles = ({ run }: Params): string[] => {
	const vendored = run.config.vendored ?? [];

	return run.current().changedFiles.filter((file) => isTestableSourceFile({ path: file }) && !vendored.some((prefix) => file.startsWith(prefix)));
};
