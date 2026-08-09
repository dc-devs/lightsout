import type { StandardsCheckInput } from '@/contracts';

interface Params {
	/** Whatever the engine built for this run — the path-carrying kinds are file-list and file-text. */
	input: StandardsCheckInput;
}

/**
 * The paths a check was handed: every file in scope, and the test files among
 * them.
 *
 * Each location rule receives the whole input union, so the narrowing is
 * written once here rather than as a cast per rule. An input carrying no path
 * lists yields empty ones: a rule that declared a path-carrying kind is never
 * handed another, so refusing loudly would describe a situation that cannot
 * arise.
 */
export const readPathLists = ({ input }: Params): { files: string[]; tests: string[]; standardsPackages: string[] } =>
	input.kind === 'file-list' || input.kind === 'file-text'
		? { files: input.files, tests: input.tests, standardsPackages: input.standardsPackages }
		: { files: [], tests: [], standardsPackages: [] };
