import type ts from 'typescript';
import type { StandardsRule } from '@/contracts';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';

export interface StandardsPassParams {
	cwd: string;
	/** Repo-relative non-test files in scope. */
	source: string[];
	/** Repo-relative test files in scope — the list the duplication passes deliberately exclude. */
	tests: string[];
	/** Both lists together, in scope order. */
	files: string[];
	/** The WHOLE repo's files, unfiltered by `--path` — reference counting must see consumers outside the scope. */
	referenceFiles: string[];
	/** Resolved severity and settings for every rule, including the ones this pass does not own. */
	states: Map<StandardsRule, ResolvedRuleState>;
	/** The consumer's TypeScript, when resolvable. A pass whose rules all declare `needsTypescript` is never called without it. */
	compiler?: typeof ts;
}
