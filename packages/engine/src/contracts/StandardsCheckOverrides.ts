import { z } from 'zod';
// Through the barrel, not the file: `standardsCheck` is a module of its own
// inside contracts, and its index.ts is the path in. No cycle — nothing under
// it reads the config.
import { StandardsSeverity } from '@/contracts/standardsCheck';

/**
 * A rule's severity, with the pre-rename spelling called out by name.
 *
 * `finding` was this severity's value until it collided with the umbrella noun
 * — every hit the check reports is a finding, at any severity. A config written
 * against the older docs gets told what happened rather than a bare list of
 * valid options, the same courtesy the renamed `scan` key gets.
 */
const standardsSeverityValue = z.enum(StandardsSeverity, {
	error: (issue) => (issue.input === 'finding' ? 'severity `finding` was renamed to `blocking`' : undefined),
});

/**
 * Per-rule overrides for `lightsout standards-check`, keyed by rule id. A
 * value is either a severity, or an object with a severity and/or that
 * rule's own settings. A rule not named here keeps its default — silence
 * is never a change.
 *
 * The ids come from the loaded standards packages, so a mistyped one cannot
 * be caught while parsing this file: `resolvePackageRuleStates` refuses a
 * key naming no loaded rule and lists the valid ids. The protection is the
 * same, it just happens where the answer exists. Read the live state with
 * `lightsout standards-check --list`.
 */
export const StandardsCheckOverrides = z.record(
	z.string(),
	z.union([
		standardsSeverityValue,
		z
			.object({
				severity: standardsSeverityValue.optional(),
				settings: z.record(z.string(), z.number()).optional(),
			})
			.strict(),
	]),
);

export type StandardsCheckOverrides = z.infer<typeof StandardsCheckOverrides>;
