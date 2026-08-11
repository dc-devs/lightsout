import { z } from 'zod';
import { messageOf } from '@/common/utils/messageOf';
import { RawStandardsFinding, type StandardsCheckInput, type StandardsCheckRun } from '@/contracts';

const rawFindings = z.array(RawStandardsFinding);

interface Params {
	/** The rule id — named in any failure, since a broken check is a package bug someone has to find. */
	rule: string;
	run: StandardsCheckRun;
	input: StandardsCheckInput;
	settings: Record<string, number>;
}

/**
 * Call one package's check and hand back what it flagged.
 *
 * The only place the engine executes a package's check, so it is the only place
 * that has to decide what a misbehaving one means: a check that throws, or that
 * returns anything other than valid raw findings, is a fault in the package and
 * is reported as one. Swallowing it would turn a broken rule into a rule that
 * silently finds nothing — the failure mode the whole package format exists to
 * make impossible.
 *
 * @param rule - the rule id, named in any failure
 * @throws {Error} When the check throws, or returns something that is not a list of raw findings.
 */
export const runRuleCheck = async ({ rule, run, input, settings }: Params): Promise<RawStandardsFinding[]> => {
	let returned: unknown;

	try {
		returned = await run({ input, settings });
	} catch (error) {
		throw new Error(`standards rule "${rule}" threw while checking: ${messageOf({ error })}`);
	}

	const parsed = rawFindings.safeParse(returned);

	if (!parsed.success) {
		const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'return value'} ${issue.message}`).join('; ');

		throw new Error(`standards rule "${rule}" returned something that is not a list of findings: ${issues}`);
	}

	return parsed.data;
};
