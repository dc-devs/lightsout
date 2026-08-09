import type { StandardsHealthRule } from '@/standardsCheck/common/types/StandardsHealthRule';

/** The package-health report: every loaded rule, plus the coverage claim counted from the package's own folders. */
export interface StandardsHealth {
	rules: StandardsHealthRule[];
	totals: { rules: number; checked: number; judgment: number };
}
