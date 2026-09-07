import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { GradeReport, GradeScope } from '#src/contracts/index.ts';

interface Params {
	/** The plan folder's `grade.json`. */
	gradePath: string;
	/** The current pass's combined inputs fingerprint. */
	sha256: string;
}

/**
 * The recorded verdict, but only when it really is the passing full review the
 * memory vouches for.
 *
 * The memory cannot speak for the file beside it: a structural preflight stop
 * written after a passing review rewrites `grade.json` without touching the
 * memory, so the verdict on disk has to say for itself that it is complete,
 * passing, full-scope and measured against these very inputs. Every other state
 * — missing, unparseable, narrowed, focused, below A, or fingerprinted against
 * inputs that have since moved — returns nothing, and the caller pays for a pass
 * that runs.
 */
export const readReusableGrade = async ({ gradePath, sha256 }: Params): Promise<GradeReport | undefined> => {
	const report = await readJsonFile({ path: gradePath, schema: GradeReport });
	const qualifies = report?.passed === true && report.complete && report.scope === GradeScope.Full && report.inputs?.sha256 === sha256;

	return qualifies ? report : undefined;
};
