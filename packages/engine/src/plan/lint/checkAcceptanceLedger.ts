import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { holdsTestTitle } from '#src/common/sourceFiles/holdsTestTitle.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { getPlanWrittenPaths } from '#src/plan/common/paths/getPlanWrittenPaths.ts';
import { isPlanSourceFile } from '#src/plan/common/paths/isPlanSourceFile.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { checkLedgerCoverage } from '#src/plan/lint/checkLedgerCoverage.ts';
import { checkMovedAwayLedgerFiles } from '#src/plan/lint/checkMovedAwayLedgerFiles.ts';

interface Params {
	plan: ParsedPlan;
	/** The repository root, read only to open the test file that answers whether a row's test already exists. */
	cwd: string;
	/** The finding label: this file's basename. */
	phase: string;
	/** Whether `plan.contract` is on — decides only whether an absent section is a finding. */
	required: boolean;
	/** The gate keys the config declares, so a row cannot name a gate nothing runs. */
	gateKeys: Set<string>;
}

/**
 * Every source file this plan writes that the prose-files list does not excuse —
 * the files a ledger row has to reach. `getPlanWrittenPaths` rather than the
 * whole heading set: a deleted file and a move's source are named by a heading
 * but written by nobody, so no test can state their behaviour.
 */
const getCoverablePaths = ({ plan }: { plan: ParsedPlan }) => {
	const excused = new Set(plan.proseFiles.map((file) => file.path));

	return [...new Set(getPlanWrittenPaths({ plan }))].filter((path) => isPlanSourceFile({ path }) && !excused.has(path));
};

/**
 * Whether a test file already on disk states this name, read from its test-call
 * heads.
 *
 * A quoted-string search would refuse a plan whose chosen name happens to appear
 * in a comment, a `describe` block or a variable in the file it names — none of
 * which is a test that already exists.
 */
const statesTest = async ({ cwd, testFile, testName }: { cwd: string; testFile: string; testName: string }) => {
	const content = await readFile(join(cwd, testFile), 'utf8').catch(() => undefined);

	return content !== undefined && holdsTestTitle({ content, testName });
};

/**
 * The path whose content answers whether the row's test already exists.
 *
 * A row may name a move's DESTINATION, which does not exist at plan time. Read
 * literally, the rule below would find nothing there and pass — so a test
 * written for older behaviour could be named as a new criterion's verifier just
 * by moving its file. The move's source is read instead: it holds the cases the
 * destination inherits.
 */
const resolveReadPath = ({ plan, testFile }: { plan: ParsedPlan; testFile: string }) => plan.movePaths.find((move) => move.to === testFile)?.from ?? testFile;

/**
 * Gate keys whose command runs tests, and so can carry a per-test result: the
 * unit suite, its instrumented twin, and any custom `test-*` suite the config
 * declares.
 */
const isTestGate = ({ gate }: { gate: string }) => gate === 'test' || gate.startsWith('test-');

/** One blocking LedgerWellFormed finding — the only check the rules in this file report under. */
const finding = ({ phase, issue, location, fix }: { phase: string; issue: string; location: string; fix: string }) => ({
	check: StructuralCheck.LedgerWellFormed,
	severity: FindingSeverity.Blocking,
	phase,
	issue,
	location,
	fix,
});

/** LedgerWellFormed — the section's own shape: rows the parser could not read, and prose-files bullets that state no reason. */
const checkShape = ({ plan, phase, required, coverable }: { plan: ParsedPlan; phase: string; required: boolean; coverable: string[] }) => {
	const findings: StructuralFinding[] = [];

	if (!plan.sections.has('Acceptance Tests') && required && coverable.length > 0) {
		findings.push(
			finding({
				phase,
				issue: 'no `## Acceptance Tests` section, and this plan writes source files no prose-files entry excuses',
				location: `${phase} → Acceptance Tests`,
				fix: 'add a `## Acceptance Tests` section with one row per acceptance criterion',
			}),
		);
	}

	for (const line of plan.malformedLedgerLines) {
		findings.push(
			finding({
				phase,
				issue: 'an Acceptance Tests row does not carry a criterion, a backticked test file and a test name',
				location: `${phase}:${line}`,
				fix: 'write the row as `| criterion | `test file` | test name | gate |`',
			}),
		);
	}

	for (const line of plan.malformedProseLines) {
		findings.push(
			finding({
				phase,
				issue: 'a Prose Files bullet names a path but states no reason',
				location: `${phase}:${line}`,
				fix: 'add ` — ` and the reason no test can state this file’s behaviour',
			}),
		);
	}

	return findings;
};

/** LedgerWellFormed — each row on its own terms: a real test file, a configured gate, no duplicate, and a test name the file does not already hold. */
const checkRows = async ({ plan, cwd, phase, gateKeys }: { plan: ParsedPlan; cwd: string; phase: string; gateKeys: Set<string> }) => {
	const findings: StructuralFinding[] = [];
	const seen = new Set<string>();

	for (const row of plan.ledger) {
		const location = `${phase}:${row.line}`;

		if (!isTestFile({ path: row.testFile })) {
			findings.push(
				finding({
					phase,
					issue: `ledger row names '${row.testFile}', which is not a test file`,
					location,
					fix: 'name a test file',
				}),
			);
		}

		// An empty set is evidence the caller passed no config, never that the
		// repository runs no gates — judging against it would report every row.
		if (gateKeys.size > 0 && !gateKeys.has(row.gate)) {
			findings.push(
				finding({
					phase,
					issue: `ledger row names gate '${row.gate}', which no configured gate runs`,
					location,
					fix: 'name a configured gate',
				}),
			);
		} else if (!isTestGate({ gate: row.gate })) {
			// Only for a gate the repository does run: a key nothing runs is one
			// mistake, and saying it twice buries the findings beside it.
			findings.push(
				finding({
					phase,
					issue: `ledger row names gate '${row.gate}', which runs no tests — no execution of it can carry a test result, so the row could never be proven`,
					location,
					fix: 'name a test gate: `test`, `test-coverage`, or a custom `test-*` suite',
				}),
			);
		}

		const key = `${row.testFile}|${row.testName}`;

		if (seen.has(key)) {
			findings.push(
				finding({
					phase,
					issue: `two ledger rows name the same test: '${row.testName}' in ${row.testFile}`,
					location,
					fix: 'give each criterion its own test, or state them as one row',
				}),
			);
		}

		seen.add(key);

		const readPath = resolveReadPath({ plan, testFile: row.testFile });

		if (await statesTest({ cwd, testFile: readPath, testName: row.testName })) {
			findings.push(
				finding({
					phase,
					issue:
						readPath === row.testFile
							? `'${row.testName}' is already a test in ${row.testFile}`
							: `'${row.testName}' is already a test in ${readPath}, which this plan moves to ${row.testFile}`,
					location,
					fix: 'name a new test, or re-point the row at one this plan adds',
				}),
			);
		}
	}

	return findings;
};

/**
 * LedgerWellFormed and LedgerCovers — the acceptance-test ledger's structural
 * check, in the shape of `checkVerificationScripts`.
 *
 * The rule runs whenever the section is present, whatever the config says: a
 * plan written on a machine with `plan.contract` on and graded on one with it
 * off must not quietly lose its checks. `required` decides one thing only —
 * whether an ABSENT section is a finding.
 *
 * A row may name a test file that already exists, because adding a case to one
 * is ordinary work. What it may not do is name a test that file already holds:
 * a test written for older behaviour must never be locked in as the verifier of
 * a new criterion.
 *
 * The overview variant is never checked; the caller passes implementable files
 * only, exactly as it does for the script check.
 */
export const checkAcceptanceLedger = async ({ plan, cwd, phase, required, gateKeys }: Params): Promise<StructuralFinding[]> => {
	const coverable = getCoverablePaths({ plan });

	return [
		...checkShape({ plan, phase, required, coverable }),
		...(await checkRows({ plan, cwd, phase, gateKeys })),
		...checkMovedAwayLedgerFiles({ plan, phase }),
		...checkLedgerCoverage({ plan, phase, coverable }),
	];
};
