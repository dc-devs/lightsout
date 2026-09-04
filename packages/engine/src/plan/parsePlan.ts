import { PlanFileKind } from '#src/plan/common/constants/PlanFileKind.ts';
import { parseAcceptanceLedger } from '#src/plan/common/parsing/parseAcceptanceLedger.ts';
import { parseProseFiles } from '#src/plan/common/parsing/parseProseFiles.ts';
import { pathFromLine } from '#src/plan/common/paths/pathFromLine.ts';
import { pathPairFromLine } from '#src/plan/common/paths/pathPairFromLine.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { planCreatePaths } from '#src/plan/planCreatePaths.ts';

/**
 * Split a plan into its `##` sections (a `###` subheading stays inside its
 * section), each carrying the 1-based line its first line sits at.
 *
 * The line number is what lets a section's own reader report a defect by
 * location rather than by position within the section — the ledger and
 * prose-files parsers both number their malformed lines that way, and a finding
 * a human cannot jump to is a finding they have to hunt for.
 */
const parseSections = ({ lines }: { lines: string[] }) => {
	const sections = new Map<string, { lines: string[]; firstLine: number }>();
	let current: string | undefined;

	for (const [index, line] of lines.entries()) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			current = heading[1];
			sections.set(current, { lines: [], firstLine: index + 2 });

			continue;
		}

		if (current !== undefined) {
			sections.get(current)?.lines.push(line);
		}
	}

	return sections;
};

/** Paths from the leading code span of each line in a section that matches `lineMatches` (`###` subheadings or `-` bullets). */
const pathsFromLines = ({ sectionLines, lineMatches }: { sectionLines: string[] | undefined; lineMatches: (line: string) => boolean }) => {
	if (!sectionLines) {
		return [];
	}

	const paths: string[] = [];

	for (const line of sectionLines) {
		if (lineMatches(line)) {
			const path = pathFromLine({ line });

			if (path) {
				paths.push(path);
			}
		}
	}

	return paths;
};

/** The backtick-delimited command in each `-` bullet of the Verification section. */
const commandsFromVerification = ({ sectionLines }: { sectionLines: string[] | undefined }): string[] => {
	if (!sectionLines) {
		return [];
	}

	const commands: string[] = [];

	for (const line of sectionLines) {
		if (!/^\s*-\s+/.test(line)) {
			continue;
		}

		const span = /`([^`]+)`/.exec(line);

		if (span) {
			commands.push(span[1].trim());
		}
	}

	return commands;
};

/**
 * The `### ` headings of the `## Files to Move` section, as source/destination
 * pairs. A heading that names fewer than two path-shaped spans is dropped from
 * the pairs and recorded by its 1-based line number instead, so the lint reports
 * it rather than losing a file the plan meant to move. Scanned over the whole
 * file rather than the section's lines because the line number is the finding's
 * location.
 */
const movesFromPlan = ({ lines }: { lines: string[] }) => {
	const moves: { from: string; to: string }[] = [];
	const malformedLines: number[] = [];
	let inMoveSection = false;

	for (const [index, line] of lines.entries()) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			inMoveSection = heading[1] === 'Files to Move';

			continue;
		}

		if (!inMoveSection || !/^###\s+/.test(line)) {
			continue;
		}

		const pair = pathPairFromLine({ line });

		if (pair) {
			moves.push(pair);
		} else {
			malformedLines.push(index + 1);
		}
	}

	return { moves, malformedLines };
};

/** The first integer in the optional `## File Budget` section — the touched-file allowance a plan declares for itself. */
const fileBudgetFrom = ({ sectionLines }: { sectionLines: string[] | undefined }) => {
	for (const line of sectionLines ?? []) {
		const match = /(\d+)/.exec(line);

		if (match) {
			return Number(match[1]);
		}
	}

	return undefined;
};

interface Params {
	/** The plan file's full text. */
	content: string;
	/** The plan file's basename — `overview.md` is one of the overview-variant signals. */
	base: string;
}

/** Parse a plan file's text into the typed `ParsedPlan` the structural lint keys off. */
export const parsePlan = ({ content, base }: Params): ParsedPlan => {
	const lines = content.split('\n');
	const parsed = parseSections({ lines });
	const sections = new Map<string, string[]>([...parsed].map(([heading, section]) => [heading, section.lines]));
	const ledgerSection = parsed.get('Acceptance Tests');
	const proseSection = parsed.get('Prose Files');
	const ledger = parseAcceptanceLedger({ sectionLines: ledgerSection?.lines, firstLine: ledgerSection?.firstLine ?? 1 });
	const prose = parseProseFiles({ sectionLines: proseSection?.lines, firstLine: proseSection?.firstLine ?? 1 });
	const title =
		lines
			.find((line) => /^#\s+/.test(line))
			?.replace(/^#\s+/, '')
			.trim() ?? '';
	const variant =
		base === 'overview.md' || (sections.has('Phases') && sections.has('Cross-Phase Dependencies')) || /—\s*Overview\s*$/.test(title)
			? PlanFileKind.Overview
			: PlanFileKind.Implementable;
	const isSubheading = (line: string) => /^###\s+/.test(line);
	const { moves, malformedLines } = movesFromPlan({ lines });

	return {
		base,
		title,
		variant,
		sections,
		createPaths: planCreatePaths({ planText: content }),
		modifyPaths: pathsFromLines({ sectionLines: sections.get('Files to Modify'), lineMatches: isSubheading }),
		earlierPhaseModifyPaths: pathsFromLines({ sectionLines: sections.get('Files to Modify from Earlier Phases'), lineMatches: isSubheading }),
		deletePaths: pathsFromLines({ sectionLines: sections.get('Files to Delete'), lineMatches: isSubheading }),
		movePaths: moves,
		malformedMoveLines: malformedLines,
		fileBudget: fileBudgetFrom({ sectionLines: sections.get('File Budget') }),
		mirrorPaths: pathsFromLines({ sectionLines: sections.get('Patterns to Mirror'), lineMatches: (line) => /^\s*-\s+/.test(line) }),
		verificationCommands: commandsFromVerification({ sectionLines: sections.get('Verification') }),
		ledger: ledger.rows,
		malformedLedgerLines: ledger.malformedLines,
		proseFiles: prose.files,
		malformedProseLines: prose.malformedLines,
		lines,
	};
};
