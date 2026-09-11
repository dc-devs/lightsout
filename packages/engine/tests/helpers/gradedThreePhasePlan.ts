import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ConfigDocs, GradeReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { gradeHistoryPath, renderDecisionLog, runPlanGrade } from '#src/plan/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';

/** The prompt markers a grade run spawns with — how one kind of agent is counted apart from the others. */
export const gapCheckMarker = '# Gap-check input';
export const recheckMarker = '# Finding-recheck input';
export const docsCheckMarker = '# Docs-check input';

/** The three existing modules the three phases each modify — one apiece, so no two phases name the same file. */
const sources = {
	'src/alpha.js': 'export const alpha = 1;\n',
	'src/beta.js': 'export const beta = 2;\n',
	'src/gamma.js': 'export const gamma = 3;\n',
};

/** The surfaces a declaring repository writes — what turns the whole-plan documentation checker on. */
export const declaredDocs: ConfigDocs = [{ path: 'README.md', covers: 'The product tour and the index of every other document.' }];

/** A structurally clean three-phase overview: the same shape the two-phase fixture has, with a third row and block. */
const threePhaseOverview = `# Graded Plan — Overview

${renderDecisionLog({ decisions: [] })}

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | alpha | 1 | 2 |
| 2 | \`phase2-extra.md\` | beta | 1 | 2 |
| 3 | \`phase3-final.md\` | gamma | 1 | 2 |

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 3 — \`phase3-final.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

## Cross-Phase Dependencies

- Phase 2 re-exports what phase 1 adds.
`;

/** One clean phase, spelled end to end in its own word, so every path and identifier in it belongs to it alone. */
const phaseBody = ({ subject, documentation }: { subject: string; documentation?: string }): string =>
	cleanPlanBody({ title: 'Graded Plan', documentation, reference: true })
		.replace(/new-thing/g, `${subject}-thing`)
		.replace(/newThing/g, `${subject}Thing`)
		.replace(/src\/index\.js/g, `src/${subject}.js`);

/**
 * The graded deliverable: phase 1 hands `alphaThing` forward and phase 2 claims
 * it, so those two are connected. Phase 3 shares no path, export or hand-off
 * with either, so a repair to phase 2 cannot reach it.
 */
const planFiles = ({ documentation }: { documentation?: string }) => ({
	'overview.md': threePhaseOverview,
	'phase1-core.md': phaseBody({ subject: 'alpha', documentation }).replace('None — standalone plan.', '- `alphaThing` — the module phase 2 re-exports.'),
	'phase2-extra.md': phaseBody({ subject: 'beta', documentation }).replace('## Prerequisites\n\n- None', '## Prerequisites\n\n- `alphaThing` from phase 1.'),
	'phase3-final.md': phaseBody({ subject: 'gamma', documentation }),
});

/** The one finding every reader returns on the baseline pass, so that pass leaves open records behind. */
export const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };

/** A sentence every phase file carries verbatim — a citation long enough for the engine to accept against any of them. */
const citation = 'A tiny clean plan for the structural lint.';

/** The re-verification answer that closes an open record: the plan now states the answer, and here is the line that says so. */
export const closingVerdict = { outcome: 'already-answered', answerAt: citation };

/** New text for one file that moves its content hash and changes nothing the lint or the connection graph reads. */
const nudgedText = ({ file, text }: { file: string; text: string }): string => {
	if (file === 'overview.md') {
		return `${text}- Phase 3 stands alone.\n`;
	}

	if (file.endsWith('.md')) {
		return text.replace('## Context\n', '## Context\n\nRepaired after the last pass.\n');
	}

	return `${text}// touched by a later change\n`;
};

interface SetupParams {
	name: string;
	/** The findings every reader returns on the BASELINE pass — cleared before the act, the way a repair clears them. */
	gaps?: unknown[];
	/** What the re-verification judge answers during the act. Absent leaves every open record open. */
	recheckVerdict?: unknown;
	/** A plan basename or a repo-relative source path to nudge after the baseline pass. Absent leaves every input where it was. */
	edited?: string;
	/** Declared documentation surfaces — what turns the whole-plan checker on. */
	docs?: ConfigDocs;
}

/** What a graded fixture hands its test: where the plan lives, the driver and its collector, and the verdict and history the baseline pass left on disk. */
interface GradedPlan {
	cwd: string;
	name: string;
	driver: Driver;
	invocations: DriverInvocation[];
	gradePath: string;
	historyPath: string;
	gradeText: string;
	historyText: string;
}

/**
 * A three-phase plan already graded once, so the memory has a baseline to
 * compare the act's inputs against. The baseline pass's findings are cleared
 * afterwards and so is the invocation collector, so every count the act asserts
 * is the act's own.
 */
export const setupGraded = async ({ name, gaps = [], recheckVerdict, edited, docs }: SetupParams): Promise<GradedPlan> => {
	const cwd = setupConsumerRepo({ sources, ...(docs === undefined ? {} : { config: { docs } }) });
	const documentation = docs === undefined ? undefined : 'Nothing user-facing — no docs needed.';
	const dir = writePhasedPlanDeliverable({ cwd, name, files: planFiles({ documentation }) });
	const readerGaps = [...gaps];
	const invocations: DriverInvocation[] = [];
	const driver = createGapCheckDriver({ gaps: readerGaps, invocations, recheckVerdict });
	const gradePath = join(dir, 'grade.json');
	const historyPath = gradeHistoryPath({ cwd, name });

	await runPlanGrade({ cwd, driver, name });

	readerGaps.length = 0;
	invocations.length = 0;

	if (edited !== undefined) {
		const path = edited.endsWith('.md') ? join(dir, edited) : join(cwd, edited);

		writeFileSync(path, nudgedText({ file: edited, text: readFileSync(path, 'utf8') }));
	}

	return {
		cwd,
		name,
		driver,
		invocations,
		gradePath,
		historyPath,
		gradeText: readFileSync(gradePath, 'utf8'),
		historyText: readFileSync(historyPath, 'utf8'),
	};
};

/** How many invocations in a collector carry one marker. */
export const countOf = ({ invocations, marker }: { invocations: DriverInvocation[]; marker: string }): number =>
	invocations.filter(({ prompt }) => prompt.includes(marker)).length;

/** The plan files the readers in a collector were given, in deliverable order. */
export const readerPhases = ({ invocations }: { invocations: DriverInvocation[] }): string[] => {
	const readers = invocations.filter(({ prompt }) => prompt.includes(gapCheckMarker));

	return [
		{ marker: 'src/alpha-thing.ts', file: 'phase1-core.md' },
		{ marker: 'src/beta-thing.ts', file: 'phase2-extra.md' },
		{ marker: 'src/gamma-thing.ts', file: 'phase3-final.md' },
	]
		.filter(({ marker }) => readers.some(({ prompt }) => prompt.includes(marker)))
		.map(({ file }) => file);
};

/** The scope every pass in a plan's history recorded, oldest first. */
export const historyScopes = ({ historyPath }: { historyPath: string }): string[] =>
	readFileSync(historyPath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => GradeReport.parse(JSON.parse(line)).scope);
