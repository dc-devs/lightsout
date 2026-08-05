import type { ParsedPlan } from '@/plan/common/types/ParsedPlan';
import { pathFromLine } from '@/plan/common/utils/pathFromLine';
import { planCreatePaths } from '@/plan/planCreatePaths';

/** Split a plan into its `##` sections (a `###` subheading stays inside its section). */
const parseSections = (lines: string[]): Map<string, string[]> => {
	const sections = new Map<string, string[]>();
	let current: string | undefined;

	for (const line of lines) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			current = heading[1];
			sections.set(current, []);

			continue;
		}

		if (current !== undefined) {
			sections.get(current)?.push(line);
		}
	}

	return sections;
};

/** Paths from the leading code span of each line in a section that matches `lineMatches` (`###` subheadings or `-` bullets). */
const pathsFromLines = ({
	sectionLines,
	lineMatches,
}: {
	sectionLines: string[] | undefined;
	lineMatches: (line: string) => boolean;
}) => {
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
const commandsFromVerification = (sectionLines: string[] | undefined): string[] => {
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

/** Parse a plan file's text into the typed `ParsedPlan` the structural lint keys off. */
export const parsePlan = ({ content, base }: { content: string; base: string }): ParsedPlan => {
	const lines = content.split('\n');
	const sections = parseSections(lines);
	const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() ?? '';
	const variant =
		base === 'overview.md' || (sections.has('Phases') && sections.has('Cross-Phase Dependencies')) || /—\s*Overview\s*$/.test(title)
			? 'overview'
			: 'implementable';

	return {
		base,
		title,
		variant,
		sections,
		createPaths: planCreatePaths({ planText: content }),
		modifyPaths: pathsFromLines({ sectionLines: sections.get('Files to Modify'), lineMatches: (line) => /^###\s+/.test(line) }),
		mirrorPaths: pathsFromLines({ sectionLines: sections.get('Patterns to Mirror'), lineMatches: (line) => /^\s*-\s+/.test(line) }),
		verificationCommands: commandsFromVerification(sections.get('Verification')),
		lines,
	};
};
