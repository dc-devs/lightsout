import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { StructuralCheck, type LightsoutConfig, type StructuralFinding } from '@lightsout/contracts';
import { isTestFile } from '../common/utils/isTestFile';
import { checkPlanPaths } from './checkPlanPaths';
import { checkVerificationScripts } from './checkVerificationScripts';
import { parsePlan } from './parsePlan';

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

const isSourceFile = (path: string) => !isTestFile(path) && !/(^|\/)index\.[jt]sx?$/.test(path) && !/\.d\.ts$/.test(path);

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
		findings.push(...(await checkPlanPaths({ plan, cwd, planPath })));

		// ScriptExists — each verification command's package script resolves.
		findings.push(...(await checkVerificationScripts({ plan, cwd, planPath, packagesDir, configCommands })));

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
