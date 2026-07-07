import type { ParsedPlan } from './common/types/ParsedPlan';
import { planCreatePaths } from './planCreatePaths';

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

/** The first backtick-delimited token in a line that is shaped like a file path (has `/` and a `.ext`). */
const pathFromLine = (line: string): string | undefined => {
	for (const match of line.matchAll(/`([^`]+)`/g)) {
		const token = match[1].trim().split(/\s+/)[0];

		if (token.includes('/') && /\.[A-Za-z0-9]+$/.test(token)) {
			return token;
		}
	}

	return undefined;
};

/** Paths from the `###` subheadings inside a Files section. */
const pathsFromSubheadings = (sectionLines: string[] | undefined): string[] => {
	if (!sectionLines) {
		return [];
	}

	const paths: string[] = [];

	for (const line of sectionLines) {
		if (/^###\s+/.test(line)) {
			const path = pathFromLine(line);

			if (path) {
				paths.push(path);
			}
		}
	}

	return paths;
};

/** Paths from the leading code span of each `-` bullet in a section (Patterns to Mirror). */
const pathsFromBullets = (sectionLines: string[] | undefined): string[] => {
	if (!sectionLines) {
		return [];
	}

	const paths: string[] = [];

	for (const line of sectionLines) {
		if (/^\s*-\s+/.test(line)) {
			const path = pathFromLine(line);

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
		modifyPaths: pathsFromSubheadings(sections.get('Files to Modify')),
		mirrorPaths: pathsFromBullets(sections.get('Patterns to Mirror')),
		verificationCommands: commandsFromVerification(sections.get('Verification')),
		lines,
	};
};
