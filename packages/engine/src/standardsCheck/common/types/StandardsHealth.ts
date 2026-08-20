import type { StandardsHealthRule } from '#src/standardsCheck/common/types/StandardsHealthRule.ts';

/** The package-health report: every loaded rule, plus the coverage claim counted from the package's own folders. */
export interface StandardsHealth {
	rules: StandardsHealthRule[];
	totals: { rules: number; checked: number; judgment: number };
}
