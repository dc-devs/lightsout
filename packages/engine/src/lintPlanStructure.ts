import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StructuralCheck, type LightsoutConfig, type StructuralFinding } from '@lightsout/contracts';

interface Params {
	cwd: string;
	/** Absolute paths to the plan file(s) to lint. */
	planPaths: string[];
	config?: LightsoutConfig;
}

/** The executor's file-count guardrail — the ceiling a single plan/phase must stay under. */
const scopeGuardrail = 50;

/** Required sections by variant — the fixed heading set the template pins. */
const requiredSections = {
	implementable: ['Prerequisites', 'Scope Boundaries', 'Verification', 'What Next Plan Expects'],
	overview: ['Phases', 'Cross-Phase Dependencies'],
} as const;

const placeholderPatterns: { label: string; re: RegExp }[] = [
	{ label: '???', re: /\?\?\?/ },
	{ label: 'TBD', re: /\bTBD\b/ },
	{ label: 'TODO', re: /\bTODO\b/ },
	{ label: 'unresolved {token}', re: /\{[A-Za-z][A-Za-z0-9_]*\}/ },
];

/** A parsed plan file: its `##` sections plus the paths and scripts the checks key off. */
interface ParsedPlan {
	base: string;
	title: string;
	variant: 'implementable' | 'overview';
	/** `## Section title` → the lines beneath it (up to the next `##`). */
	sections: Map<string, string[]>;
	createPaths: string[];
	modifyPaths: string[];
	mirrorPaths: string[];
	verificationCommands: string[];
	lines: string[];
}

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

/** The package-script name a verification command invokes, or undefined for a raw command with no package-manager prefix. */
const scriptNameOf = (command: string): string | undefined => {
	const tokens = command.split(/\s+/);

	if (tokens[0] === 'pnpm') {
		if (tokens[1] === '--filter') {
			return tokens[3];
		}

		if (tokens[1] === 'run') {
			return tokens[2];
		}

		return tokens[1];
	}

	if ((tokens[0] === 'npm' || tokens[0] === 'yarn') && tokens[1] === 'run') {
		return tokens[2];
	}

	if (tokens[0] === 'yarn') {
		return tokens[1];
	}

	return undefined;
};

const parsePlan = ({ content, base }: { content: string; base: string }): ParsedPlan => {
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
		createPaths: pathsFromSubheadings(sections.get('Files to Create')),
		modifyPaths: pathsFromSubheadings(sections.get('Files to Modify')),
		mirrorPaths: pathsFromBullets(sections.get('Patterns to Mirror')),
		verificationCommands: commandsFromVerification(sections.get('Verification')),
		lines,
	};
};

const pathExists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

const isSourceFile = (path: string) =>
	!/(^|\/)tests?\//.test(path) && !/\.(test|spec)\./.test(path) && !/(^|\/)index\.[jt]sx?$/.test(path) && !/\.d\.ts$/.test(path);

/**
 * The deterministic structural lint — no agent. This is to plans what
 * `runScan`'s detectors are to code: it keys off the fixed structure the plan
 * template pins (the `##` heading set, the `###` create/modify subheadings, the
 * Patterns-to-Mirror bullet code spans, the Verification command spans) and
 * reports each defect as typed data. Every path is `stat`ed, every verification
 * script is looked up in a package.json (honoring `config.scripts` full-command
 * overrides), placeholders and required sections are matched textually, and the
 * create/modify source-file count is checked against the executor guardrail. The
 * `naming-matches` check no-ops without a machine-checkable convention (the
 * facts' `namingConvention` is free-text prose), and `packages-identifiable`
 * only fires on a malformed `packagesDir/` path — both are conservative by
 * design, never guessing.
 */
export const lintPlanStructure = async ({ cwd, planPaths, config }: Params): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];
	const packagesDir = config?.packagesDir ?? 'packages';
	const configCommands = new Set(Object.values(config?.scripts ?? {}).filter((value): value is string => typeof value === 'string'));

	for (const planPath of planPaths) {
		const content = await readFile(planPath, 'utf8').catch(() => undefined);

		if (content === undefined) {
			findings.push({
				check: StructuralCheck.SectionsPresent,
				issue: 'plan file could not be read',
				location: planPath,
				fix: 'ensure the draft wrote the plan file at this path',
			});

			continue;
		}

		const plan = parsePlan({ content, base: basename(planPath) });

		// SectionsPresent — required headings per variant.
		for (const section of requiredSections[plan.variant]) {
			if (!plan.sections.has(section)) {
				findings.push({
					check: StructuralCheck.SectionsPresent,
					issue: `missing required section '## ${section}' (${plan.variant} plan)`,
					location: basename(planPath),
					fix: `add a '## ${section}' section`,
				});
			}
		}

		// PathExists — modify/mirror paths must exist; create paths must not.
		for (const path of [...plan.modifyPaths, ...plan.mirrorPaths]) {
			if (!(await pathExists(join(cwd, path)))) {
				findings.push({
					check: StructuralCheck.PathExists,
					issue: `referenced path does not exist: ${path}`,
					location: `${basename(planPath)} → ${path}`,
					fix: `correct the path or move it under Files to Create if it does not exist yet`,
				});
			}
		}

		for (const path of plan.createPaths) {
			if (await pathExists(join(cwd, path))) {
				findings.push({
					check: StructuralCheck.PathExists,
					issue: `Files to Create path already exists: ${path}`,
					location: `${basename(planPath)} → ${path}`,
					fix: `move it to Files to Modify, or choose a new path`,
				});
			}
		}

		// ScriptExists — each verification command's package script resolves.
		const packageDirs = new Set<string>();

		for (const path of [...plan.createPaths, ...plan.modifyPaths, ...plan.mirrorPaths]) {
			if (path.startsWith(`${packagesDir}/`)) {
				const segment = path.slice(packagesDir.length + 1).split('/')[0];

				if (segment) {
					packageDirs.add(segment);
				}
			}
		}

		const manifestPaths = [join(cwd, 'package.json'), ...[...packageDirs].map((dir) => join(cwd, packagesDir, dir, 'package.json'))];
		const availableScripts = new Set<string>();

		for (const manifestPath of manifestPaths) {
			const raw = await readFile(manifestPath, 'utf8').catch(() => undefined);

			if (!raw) {
				continue;
			}

			try {
				const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };

				for (const key of Object.keys(parsed.scripts ?? {})) {
					availableScripts.add(key);
				}
			} catch {
				// unreadable manifest contributes no scripts
			}
		}

		for (const command of plan.verificationCommands) {
			if (configCommands.has(command)) {
				continue;
			}

			const scriptName = scriptNameOf(command);

			// A raw command with no package-manager prefix (e.g. `tsc --noEmit`) is
			// not a package script — do not guess it into a finding.
			if (scriptName === undefined) {
				continue;
			}

			if (!availableScripts.has(scriptName)) {
				findings.push({
					check: StructuralCheck.ScriptExists,
					issue: `verification command '${command}' references package script '${scriptName}' which is not in any target package.json`,
					location: `${basename(planPath)} → Verification`,
					fix: `use a script that exists, or add '${scriptName}' to the package.json`,
				});
			}
		}

		// NoPlaceholders — no unresolved markers remain.
		for (const { label, re } of placeholderPatterns) {
			const index = plan.lines.findIndex((line) => re.test(line));

			if (index !== -1) {
				findings.push({
					check: StructuralCheck.NoPlaceholders,
					issue: `unresolved placeholder '${label}' present`,
					location: `${basename(planPath)}:${index + 1}`,
					fix: `resolve '${label}' — every open question must be decided before the plan is written`,
				});
			}
		}

		// ScopeWithinGuardrail — create/modify source-file count under the ceiling.
		const sourceCount = [...plan.createPaths, ...plan.modifyPaths].filter(isSourceFile).length;

		if (sourceCount > scopeGuardrail) {
			findings.push({
				check: StructuralCheck.ScopeWithinGuardrail,
				issue: `plan touches ${sourceCount} source files, over the ${scopeGuardrail}-file executor guardrail`,
				location: basename(planPath),
				fix: `split into phases so each stays under ${scopeGuardrail} source files`,
			});
		}

		// PackagesIdentifiable — a packagesDir/ path must name a package segment.
		for (const path of [...plan.createPaths, ...plan.modifyPaths]) {
			if (path.startsWith(`${packagesDir}/`) && !path.slice(packagesDir.length + 1).includes('/')) {
				findings.push({
					check: StructuralCheck.PackagesIdentifiable,
					issue: `path '${path}' is directly under ${packagesDir}/ with no package segment`,
					location: `${basename(planPath)} → ${path}`,
					fix: `place the file under ${packagesDir}/<package>/…`,
				});
			}
		}
	}

	return findings;
};
