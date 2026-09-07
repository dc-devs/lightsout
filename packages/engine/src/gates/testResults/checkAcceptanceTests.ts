import { join } from 'node:path';
import { matchesTestTitle } from '#src/common/sourceFiles/matchesTestTitle.ts';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import { type GateResult, TestCaseStatus, type TestResultsFile } from '#src/contracts/index.ts';
import { readTestResults } from '#src/gates/testResults/readTestResults.ts';
import { satisfiesGateKey } from '#src/gates/testResults/satisfiesGateKey.ts';

/**
 * Whether one gate execution could carry this row's result: it ran, it came back
 * green, it recorded a results directory, its family answers for the row's gate
 * key, and its package group covers the file the row names.
 *
 * Only a green gate counts, so a red gate reaches the fix role as gate output
 * and never as this family. Only a covering group counts, so a sibling package's
 * green result is never read as evidence about a file it never executed.
 */
const covers = ({ gate, row, packagesDir }: { gate: GateResult; row: AcceptanceRow; packagesDir: string }) =>
	gate.skipped !== true &&
	gate.exitCode === 0 &&
	gate.testResultsDir !== undefined &&
	satisfiesGateKey({ gate: row.gate, kind: gate.kind }) &&
	(gate.group === 'root' || gate.group === packageOf({ file: row.testFile, packagesDir }));

/** One read per results directory, shared across every row that counts it. */
const createResultsReader = ({ cwd }: { cwd: string }) => {
	const readings = new Map<string, Promise<TestResultsFile['testResults']>>();

	return ({ dir }: { dir: string }) => {
		const started = readings.get(dir) ?? readTestResults({ cwd, dir: join(cwd, dir) });

		readings.set(dir, started);

		return started;
	};
};

type ReadResults = ReturnType<typeof createResultsReader>;

/** Every reported status for the cases matching this row, across the directories its gates wrote. */
const statusesFor = async ({ row, dirs, read }: { row: AcceptanceRow; dirs: string[]; read: ReadResults }) => {
	const statuses: string[] = [];

	for (const dir of dirs) {
		for (const file of await read({ dir })) {
			if (file.testFilePath !== row.testFile) {
				continue;
			}

			statuses.push(
				...file.assertionResults
					.filter(
						(assertion) =>
							matchesTestTitle({ testName: row.testName, title: assertion.title }) || matchesTestTitle({ testName: row.testName, title: assertion.fullName }),
					)
					.map((assertion) => assertion.status),
			);
		}
	}

	return statuses;
};

/**
 * What the evidence says about one row — undefined when it is proved, else the
 * reason it is not.
 *
 * A row is proved by at least one matching case with every match passing. A
 * literal name normally matches one case; it matches several when jest expanded
 * it under a `describe.each` ancestor, and a template name matches one case per
 * table row. In every one of those shapes "all of them passed" is exactly what
 * the row claims, which is why there is no ambiguity rule.
 */
const judgeRow = async ({ row, dirs, read }: { row: AcceptanceRow; dirs: string[]; read: ReadResults }) => {
	const statuses = await statusesFor({ row, dirs, read });
	const notPassing = statuses.filter((status) => status !== TestCaseStatus.Passed);
	let reason: string | undefined;

	if (statuses.length === 0) {
		reason = 'no case of that name was reported by the gate that ran';
	} else if (notPassing.length > 0) {
		reason = `${notPassing.length} of ${statuses.length} matching case(s) did not pass (${[...new Set(notPassing)].join(', ')})`;
	}

	return reason;
};

const describeRow = ({ row, reason }: { row: AcceptanceRow; reason: string }) => `- \`${row.testName}\` in ${row.testFile} (gate \`${row.gate}\`): ${reason}`;

interface Params {
	cwd: string;
	/** The acceptance tests this checkpoint must prove. */
	rows: AcceptanceRow[];
	/** Every gate result this checkpoint observed, each carrying the directory it wrote. */
	gates: GateResult[];
	/** True at the run's last verification, where an unproven row is a failure rather than a skip. */
	final: boolean;
	/** The packages directory, so a package group's results are matched to the files it owns. */
	packagesDir: string;
	/** One line per row whose gate did not run at a non-final checkpoint. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * The deterministic post-gate check: every acceptance test must be shown to have
 * executed and passed under the gate its row names.
 *
 * A green gate command and an unchanged quoted string do not establish that a
 * named case ran — during LO-81 ten cases disappeared through a move and every
 * check stayed green. This reads the per-test results the gate itself wrote and
 * holds each row to its own execution.
 *
 * A row no observed gate could carry is skipped with a progress line, because a
 * checkpoint may legitimately run a narrower schedule. At the run's final
 * verification the same row is a failure: the run must end with every acceptance
 * test executed against the finished tree.
 *
 * @returns undefined when every row is proved or legitimately skipped, else the message the verify step turns into the `acceptance-tests` failure family.
 */
export const checkAcceptanceTests = async ({ cwd, rows, gates, final, packagesDir, onProgress }: Params): Promise<string | undefined> => {
	if (rows.length === 0) {
		return undefined;
	}

	const read = createResultsReader({ cwd });
	const unproven: string[] = [];

	for (const row of rows) {
		const dirs = [...new Set(gates.filter((gate) => covers({ gate, row, packagesDir })).flatMap((gate) => gate.testResultsDir ?? []))];

		if (dirs.length === 0) {
			if (final) {
				unproven.push(describeRow({ row, reason: 'its gate did not run at this checkpoint, so the test never executed against the finished tree' }));
			} else {
				onProgress?.(`acceptance test not judged here — gate \`${row.gate}\` did not run: \`${row.testName}\` in ${row.testFile}`);
			}

			continue;
		}

		const reason = await judgeRow({ row, dirs, read });

		if (reason !== undefined) {
			unproven.push(describeRow({ row, reason }));
		}
	}

	return unproven.length === 0
		? undefined
		: [
				`acceptance-tests: ${unproven.length} acceptance test(s) were not shown to have executed and passed:`,
				...unproven,
				'',
				'Each test above states an acceptance criterion of the plan and must run and pass under its gate. Fix the source so the named test executes and passes.',
			].join('\n');
};
