import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { holdsTestTitle } from '#src/common/sourceFiles/holdsTestTitle.ts';
import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';
import { type AcceptanceTestRecord, type TestChangeReview, TestDisposition, TestReviewDecision } from '#src/contracts/index.ts';
import type { TestChange } from '#src/pipeline/approvedTests/common/types/TestChange.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

type Verdict = TestChangeReview['verdicts'][number];
type Disposition = Verdict['acceptanceTests'][number];

/** The fields each disposition kind cannot be applied without. */
const requiredFields: Record<TestDisposition, (keyof Disposition)[]> = {
	[TestDisposition.Kept]: [],
	[TestDisposition.Renamed]: ['newTestName'],
	[TestDisposition.Moved]: ['testFile'],
	[TestDisposition.Replaced]: ['newTestName', 'testFile'],
};

/** Why this disposition cannot be applied, or undefined when it can. */
const refuseDisposition = ({ path, disposition }: { path: string; disposition: Disposition }) => {
	const missing = requiredFields[disposition.disposition].filter((field) => disposition[field] === undefined);

	if (missing.length > 0) {
		return `${path}: the \`${disposition.disposition}\` disposition for \`${disposition.testName}\` names no ${missing.join(' and no ')}, so it cannot be applied`;
	}

	if (disposition.testFile !== undefined && !isTestSideFile({ path: disposition.testFile })) {
		return `${path}: the disposition for \`${disposition.testName}\` points at ${disposition.testFile}, which is not a test-side file — an acceptance test parked outside the tests is a test nothing collects`;
	}

	return undefined;
};

/** The row as the disposition leaves it. `criterion` and `gate` never move: a disposition changes where a requirement is stated, never what it is. */
const applyTo = ({ row, disposition }: { row: AcceptanceTestRecord; disposition: Disposition }): AcceptanceTestRecord => ({
	...row,
	testName: disposition.newTestName ?? row.testName,
	testFile: disposition.testFile ?? row.testFile,
});

const describeVerdict = ({ verdict, rows }: { verdict: Verdict; rows: AcceptanceTestRecord[] }) => {
	const named = rows.filter((row) => row.testFile === verdict.path).map((row) => `\`${row.testName}\``);
	const carrying = named.length === 0 ? '' : ` — acceptance tests stated in this file: ${named.join(', ')}`;

	return `${verdict.path}: ${verdict.reason}${carrying}`;
};

interface Params {
	run: PipelineRun;
	/** The bundle the reviewer was given. */
	changes: TestChange[];
	/** What it returned. */
	review: TestChangeReview;
	/** The live mapping as the manifest carries it now. */
	acceptanceTests: AcceptanceTestRecord[];
}

/**
 * The deterministic half of the verdict — what makes an approval a guarantee
 * rather than the reviewer's word.
 *
 * A bundled path nobody judged is a rejection, a verdict about a path the engine
 * never showed the reviewer is ignored whole, a disposition may only point at a
 * test-side path and must carry the fields its kind needs, and — once the
 * mapping is rewritten — every acceptance test must still be locatable by title
 * in the file it now names. That last check is what overrides an approval whose
 * disposition points at nothing.
 *
 * An acceptance test in an approved file that the verdict named no disposition
 * for is treated as `kept`, so a reviewer that forgot a row cannot make the
 * engine lose it: the locator then decides whether "kept" was true.
 */
export const applyTestDispositions = async ({
	run,
	changes,
	review,
	acceptanceTests,
}: Params): Promise<{ rejections: string[]; acceptanceTests: AcceptanceTestRecord[]; approvedPaths: string[] }> => {
	const bundled = changes.map((change) => change.path);
	const verdicts = review.verdicts.filter((verdict) => bundled.includes(verdict.path));
	const unreviewed = bundled.filter((path) => !verdicts.some((verdict) => verdict.path === path));
	const refused = verdicts.filter((verdict) => verdict.decision === TestReviewDecision.Reject);
	const rejections = [
		...unreviewed.map((path) => `${path}: the reviewer returned no verdict for this file, so its change is unreviewed`),
		...refused.map((verdict) => describeVerdict({ verdict, rows: acceptanceTests })),
	];
	const approvedPaths = verdicts.filter((verdict) => verdict.decision === TestReviewDecision.Approve).map((verdict) => verdict.path);
	const next: AcceptanceTestRecord[] = [];

	for (const row of acceptanceTests) {
		const verdict = verdicts.find((entry) => entry.path === row.testFile && entry.decision === TestReviewDecision.Approve);
		const disposition = verdict?.acceptanceTests.find((entry) => entry.testName === row.testName);
		const refusal = disposition === undefined ? undefined : refuseDisposition({ path: row.testFile, disposition });

		rejections.push(...(refusal === undefined ? [] : [refusal]));
		next.push(disposition === undefined || refusal !== undefined ? row : applyTo({ row, disposition }));
	}

	for (const row of next) {
		const content = await readFile(join(run.cwd, row.testFile), 'utf8').catch(() => undefined);

		if (content === undefined || !holdsTestTitle({ content, testName: row.testName })) {
			rejections.push(`${row.criterion}: \`${row.testName}\` is not stated in ${row.testFile} after the review's dispositions were applied`);
		}
	}

	return { rejections, acceptanceTests: next, approvedPaths };
};
