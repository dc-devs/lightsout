import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { getPlanHeadingPaths } from '#src/plan/common/paths/getPlanHeadingPaths.ts';
import { getPlanWrittenPaths } from '#src/plan/common/paths/getPlanWrittenPaths.ts';
import { isPlanSourceFile } from '#src/plan/common/paths/isPlanSourceFile.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	/** The repository root, read only to open a test file a row names when that file already exists. */
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

/** Whether a test file already on disk states this name — a quoted string is how every test runner spells one. */
const holdsTestName = async ({ cwd, testFile, testName }: { cwd: string; testFile: string; testName: string }) => {
	const content = await readFile(join(cwd, testFile), 'utf8').catch(() => undefined);

	return content !== undefined && [`'${testName}'`, `"${testName}"`, `\`${testName}\``].some((quoted) => content.includes(quoted));
};

/** One blocking finding, at whichever of the two ledger checks the caller names. */
const finding = ({ check, phase, issue, location, fix }: { check: StructuralCheck; phase: string; issue: string; location: string; fix: string }) => ({
	check,
	severity: FindingSeverity.Blocking,
	phase,
	issue,
	location,
	fix,
});

/** LedgerWellFormed — the section's own shape: rows the parser could not read, and prose-files bullets that state no reason. */
const checkShape = ({ plan, phase, required, coverable }: { plan: ParsedPlan; phase: string; required: boolean; coverable: string[] }) => {
	const findings: StructuralFinding[] = [];
	const shared = { check: StructuralCheck.LedgerWellFormed, phase };

	if (!plan.sections.has('Acceptance Tests') && required && coverable.length > 0) {
		findings.push(
			finding({
				...shared,
				issue: 'no `## Acceptance Tests` section, and this plan writes source files no prose-files entry excuses',
				location: `${phase} → Acceptance Tests`,
				fix: 'add a `## Acceptance Tests` section with one row per acceptance criterion',
			}),
		);
	}

	for (const line of plan.malformedLedgerLines) {
		findings.push(
			finding({
				...shared,
				issue: 'an Acceptance Tests row does not carry a criterion, a backticked test file and a test name',
				location: `${phase}:${line}`,
				fix: 'write the row as `| criterion | `test file` | test name | gate |`',
			}),
		);
	}

	for (const line of plan.malformedProseLines) {
		findings.push(
			finding({
				...shared,
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
	const shared = { check: StructuralCheck.LedgerWellFormed, phase };
	const seen = new Set<string>();

	for (const row of plan.ledger) {
		const location = `${phase}:${row.line}`;

		if (!isTestFile({ path: row.testFile })) {
			findings.push(
				finding({
					...shared,
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
					...shared,
					issue: `ledger row names gate '${row.gate}', which no configured gate runs`,
					location,
					fix: 'name a configured gate',
				}),
			);
		}

		const key = `${row.testFile}|${row.testName}`;

		if (seen.has(key)) {
			findings.push(
				finding({
					...shared,
					issue: `two ledger rows name the same test: '${row.testName}' in ${row.testFile}`,
					location,
					fix: 'give each criterion its own test, or state them as one row',
				}),
			);
		}

		seen.add(key);

		if (await holdsTestName({ cwd, testFile: row.testFile, testName: row.testName })) {
			findings.push(
				finding({
					...shared,
					issue: `'${row.testName}' is already a test in ${row.testFile}`,
					location,
					fix: 'name a new test, or re-point the row at one this plan adds',
				}),
			);
		}
	}

	return findings;
};

/**
 * LedgerWellFormed — a ledger row may not name a test file the same plan also
 * changes.
 *
 * A ledger file is frozen the moment `write-ledger-tests` writes it: the lock
 * restores its copy before every gate, which is what makes a supplied test a
 * spec rather than a suggestion. A plan that also lists that file under a change
 * heading is therefore ordering an edit the lock reverts, and the run reaches an
 * escalation whose only remedy is the edit it is forbidden to make. Two runs
 * died that way before this check existed, at $17 and $30, both on plans that
 * graded A.
 *
 * `createPaths` is deliberately absent from the comparison. A test file this
 * plan creates has no prior content to preserve, so writing it for the ledger IS
 * the plan's change to it, and naming it in both places says one thing rather
 * than two contradictory ones.
 *
 * A move's DESTINATION counts, because the destination inherits the source's
 * cases: freezing it after the ledger's rows are written is what dropped ten
 * cases on LO-81. A move's source counts too — the file does not survive the
 * plan, so a row naming it is a row pointed at nothing.
 */
const checkFrozenFileEdits = ({ plan, phase }: { plan: ParsedPlan; phase: string }) => {
	const findings: StructuralFinding[] = [];
	const shared = { check: StructuralCheck.LedgerWellFormed, phase };
	const changed = new Map<string, string>();

	for (const path of plan.modifyPaths) {
		changed.set(path, 'Files to Modify');
	}

	for (const path of plan.earlierPhaseModifyPaths) {
		changed.set(path, 'Files to Modify from Earlier Phases');
	}

	for (const move of plan.movePaths) {
		changed.set(move.from, 'Files to Move');
		changed.set(move.to, 'Files to Move');
	}

	// One finding per file rather than per row: a ledger naming the same frozen
	// file twelve times is one mistake, and twelve copies of the same sentence
	// bury the other findings beside them.
	const reported = new Set<string>();

	for (const row of plan.ledger) {
		const heading = changed.get(row.testFile);

		if (heading !== undefined && !reported.has(row.testFile)) {
			reported.add(row.testFile);
			findings.push(
				finding({
					...shared,
					issue: `ledger row names '${row.testFile}', which this plan also lists under \`## ${heading}\` — the ledger lock freezes that file, so the change it asks for would be reverted before the gates run`,
					location: `${phase}:${row.line}`,
					fix: 'either drop the file from the change heading and let the ledger row own it, or drop the row and let the plan edit the file',
				}),
			);
		}
	}

	return findings;
};

/**
 * LedgerCovers — the ledger states at least one criterion when the plan writes a
 * source file no prose-files entry excuses, and no prose-files entry excuses a
 * file the plan never names.
 *
 * Coverage is checked per plan, not per file: `coverable` is read for its length
 * only, so a plan writing ten source files with one row passes here. Matching a
 * row to the file it covers needs the row to say which file it is about, and a
 * criterion is a sentence rather than a path. The per-file check waits for that;
 * until then a human reader of the ledger is what catches the eight missing rows.
 */
const checkCoverage = ({ plan, phase, coverable }: { plan: ParsedPlan; phase: string; coverable: string[] }) => {
	const findings: StructuralFinding[] = [];
	const shared = { check: StructuralCheck.LedgerCovers, phase };
	// The file headings alone, not `getPlanNamedPaths`: that list also carries the
	// ledger's own test files, and a prose exemption pointing at one of those
	// would excuse a file no heading ever claimed.
	const named = new Set(getPlanHeadingPaths({ plan }));

	// Present but stating nothing. An ABSENT section is the shape check's business
	// when the switch is on, and nobody's when it is off: a repository that never
	// turned the key on must see exactly what it saw before the key existed.
	if (plan.sections.has('Acceptance Tests') && plan.ledger.length === 0 && coverable.length > 0) {
		findings.push(
			finding({
				...shared,
				issue: `the acceptance-test ledger states no criterion, while this plan writes ${coverable.length} source file(s)`,
				location: `${phase} → Acceptance Tests`,
				fix: 'add a row per acceptance criterion, or list the file under `## Prose Files` with a reason',
			}),
		);
	}

	for (const file of plan.proseFiles) {
		if (!named.has(file.path)) {
			findings.push(
				finding({
					...shared,
					issue: `Prose Files names '${file.path}', which is under none of this plan's file headings`,
					location: `${phase}:${file.line}`,
					fix: 'list it under a file heading, or remove the entry',
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
		...checkFrozenFileEdits({ plan, phase }),
		...checkCoverage({ plan, phase, coverable }),
	];
};
