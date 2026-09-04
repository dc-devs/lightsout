interface Params {
	contract?: boolean;
}

/**
 * The template's `contractRule` token: the rule a repository writing contract
 * plans adds to the fixed set, or nothing at all. Substituted either way, for
 * the same reason `documentationRule` is.
 */
export const contractRule = ({ contract }: Params): string =>
	contract === true
		? `- **Acceptance tests named, not narrated.** Every IMPLEMENTABLE variant — a
  Single Plan, and each Phase Plan — carries a \`## Acceptance Tests\` table with
  one row per acceptance criterion: the criterion, the test file that states it
  in a backticked span, the exact test name, and the gate that runs it. A file
  whose behaviour no test can state is listed under \`## Prose Files\` with the
  reason instead. Every created or modified source file is reached by a row or
  named in that list. An Overview Plan carries neither section: the overview
  creates nothing, so a row written there would belong to no executor.`
		: '';
