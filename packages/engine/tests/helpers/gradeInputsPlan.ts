import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DecisionRow, Effort, LightsoutConfig } from '#src/contracts/index.ts';

/** A parsed consumer config differing only in the one plan-relevant key each case varies. */
export const gradeInputsConfig = ({ packagesDir = 'packages' }: { packagesDir?: string } = {}): LightsoutConfig =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'packages-dir': packagesDir });

/**
 * A temp repo holding one changed source file and a three-file phased plan, plus
 * the arguments one pass measures it with.
 *
 * The git probes are not touched here: a pass taken where neither question could
 * be answered is not the same as one taken on a clean tree, so each test file
 * answers them itself and this fixture states only what is on disk.
 */
export const seedGradeInputsPlan = (): {
	cwd: string;
	overviewPath: string;
	phaseTwoPath: string;
	params: { cwd: string; planPaths: string[]; decisions: DecisionRow[]; standards: string; config: LightsoutConfig; model: string; effort: Effort };
} => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-grade-inputs-'));
	const planDir = join(cwd, '.lightsout', 'plans', 'p');

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;\n');

	mkdirSync(planDir, { recursive: true });

	const overviewPath = join(planDir, 'overview.md');
	const phaseOnePath = join(planDir, 'phase-1.md');
	const phaseTwoPath = join(planDir, 'phase-2.md');

	writeFileSync(overviewPath, '# Overview\n');
	writeFileSync(phaseOnePath, '# Phase 1\n');
	writeFileSync(phaseTwoPath, '# Phase 2\n');

	return {
		cwd,
		overviewPath,
		phaseTwoPath,
		params: {
			cwd,
			planPaths: [overviewPath, phaseOnePath, phaseTwoPath],
			decisions: [],
			standards: 'the supplemental standards text',
			config: gradeInputsConfig(),
			model: 'claude-opus-5',
			effort: Effort.High,
		},
	};
};

/**
 * An overview whose design text and generated Decision Log can each be varied
 * alone, so a comparison states which of the two a hash follows.
 */
export const overviewWithLog = ({
	design = 'The cache sits beside the store.',
	log = '| 1 | Elicitation | Which store holds the cache? |',
}: {
	design?: string;
	log?: string;
} = {}): string =>
	[
		'# Overview',
		'',
		'## Context',
		'',
		design,
		'',
		'## Decision Log',
		'',
		'| # | Source | Decision / Question |',
		'|---|--------|---------------------|',
		log,
		'',
		'## Global Constraints',
		'',
		'- None',
		'',
	].join('\n');

/**
 * An overview carrying two `## Decision Log` headings. The parser locates the
 * last section of a repeated name, so `stray` sits under the heading
 * `decisionLogRange` does not locate — the one the log-matches-record check
 * never compares against the record.
 */
export const overviewWithTwoLogs = ({ stray }: { stray: string }): string =>
	[
		'# Overview',
		'',
		'## Decision Log',
		'',
		stray,
		'',
		'## Context',
		'',
		'The cache sits beside the store.',
		'',
		'## Decision Log',
		'',
		'| # | Source | Decision / Question |',
		'|---|--------|---------------------|',
		'| 1 | Elicitation | Which store holds the cache? |',
		'',
		'## Global Constraints',
		'',
		'- None',
		'',
	].join('\n');

/**
 * A two-phase overview carrying every section one really has: the shared prose
 * every phase reads, the two sections the engine composes from the decision
 * record, and the `## Phases` table and `## Phase Declarations` blocks whose
 * per-phase spans describe one phase alone. The project-wide rule and one
 * phase's row are each varied on their own, so a comparison states which of them
 * a hash follows.
 */
export const phasedOverview = ({
	constraint = 'Every write goes through the store',
	phaseOneScope = 'the core',
}: {
	constraint?: string;
	phaseOneScope?: string;
} = {}): string =>
	[
		'# Overview',
		'',
		'## Context',
		'',
		'The cache sits beside the store.',
		'',
		'## Decision Log',
		'',
		'| # | Source | Decision / Question |',
		'|---|--------|---------------------|',
		'| 1 | Elicitation | Which store holds the cache? |',
		'',
		'## Global Constraints',
		'',
		`- ${constraint}`,
		'',
		'## Phases',
		'',
		'| # | File | Scope | Creates | Touches |',
		'|---|------|-------|---------|---------|',
		`| 1 | \`phase-1.md\` | ${phaseOneScope} | 1 | 1 |`,
		'| 2 | `phase-2.md` | the rest | 1 | 1 |',
		'',
		'## Phase Declarations',
		'',
		'### Phase 1 — `phase-1.md`',
		'',
		'- **Creates:** none',
		'- **Exports:** none',
		'- **Scripts:** none',
		'',
		'### Phase 2 — `phase-2.md`',
		'',
		'- **Creates:** none',
		'- **Exports:** none',
		'- **Scripts:** none',
		'',
		'## Cross-Phase Dependencies',
		'',
		'- Phase 2 reads the store phase 1 creates.',
		'',
	].join('\n');
