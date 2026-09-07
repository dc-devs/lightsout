import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type ConfigDocs, GradeReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { gradeMemoryPath } from '#src/plan/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';

// How far one `plan grade` pass reaches: the phases a repair can touch, the
// whole plan when the scope cannot be narrowed, and the passing review that is
// reported as current rather than paid for twice.

/** The prompt markers a grade run spawns with — how one kind of agent is counted apart from the others. */
const gapCheckMarker = '# Gap-check input';
const recheckMarker = '# Finding-recheck input';
const docsCheckMarker = '# Docs-check input';

/** The three existing modules the three phases each modify — one apiece, so no two phases name the same file. */
const sources = {
	'src/alpha.js': 'export const alpha = 1;\n',
	'src/beta.js': 'export const beta = 2;\n',
	'src/gamma.js': 'export const gamma = 3;\n',
};

/** The surfaces a declaring repository writes — what turns the whole-plan documentation checker on. */
const declaredDocs: ConfigDocs = [{ path: 'README.md', covers: 'The product tour and the index of every other document.' }];

/** A structurally clean three-phase overview: the same shape the two-phase fixture has, with a third row and block. */
const threePhaseOverview = `# Graded Plan — Overview

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
	cleanPlanBody({ title: 'Graded Plan', documentation })
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
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };

/** A sentence every phase file carries verbatim — a citation long enough for the engine to accept against any of them. */
const citation = 'A tiny clean plan for the structural lint.';

/** The re-verification answer that closes an open record: the plan now states the answer, and here is the line that says so. */
const closingVerdict = { outcome: 'already-answered', answerAt: citation };

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

/**
 * A three-phase plan already graded once, so the memory has a baseline to
 * compare the act's inputs against. The baseline pass's findings are cleared
 * afterwards and so is the invocation collector, so every count the act asserts
 * is the act's own.
 */
const setupGraded = async ({ name, gaps = [], recheckVerdict, edited, docs }: SetupParams) => {
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
const countOf = ({ invocations, marker }: { invocations: DriverInvocation[]; marker: string }): number =>
	invocations.filter(({ prompt }) => prompt.includes(marker)).length;

/** The plan files the readers in a collector were given, in deliverable order. */
const readerPhases = ({ invocations }: { invocations: DriverInvocation[] }): string[] => {
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
const historyScopes = ({ historyPath }: { historyPath: string }): string[] =>
	readFileSync(historyPath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => GradeReport.parse(JSON.parse(line)).scope);

describe('runPlanGrade', () => {
	test('plan grade: a focused pass reads the edited phase and its connected neighbour only', async () => {
		const { cwd, name, driver, invocations } = await setupGraded({ name: 'focused-closure', gaps: [omittedDecisionGap], edited: 'phase2-extra.md' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// phase 1 is read because phase 2 consumes what it hands forward; phase 3
		// shares nothing with either, so a repair to phase 2 cannot reach it
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(6);
		expect(result.grade.scope).toBe('focused');
		expect(result.grade.focusedOn).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
		expect(result.grade.phasesChecked).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	});

	test('plan grade: nothing edited spawns no reader and re-verifies every open record', async () => {
		const { cwd, name, driver, invocations } = await setupGraded({ name: 'nothing-edited', gaps: [omittedDecisionGap] });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// no phase text moved, so there is nothing for a reader to re-read
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(0);
		expect(countOf({ invocations, marker: docsCheckMarker })).toBe(0);
		// the baseline pass left three phases × three lenses of unanswered questions,
		// and each one is asked again against the current plan text
		expect(countOf({ invocations, marker: recheckMarker })).toBe(9);
		// a pass that offered no file to a reader claims no lens
		expect(result.grade.lenses).toStrictEqual([]);
		expect(result.grade.passed).toBe(false);
	});

	test('plan grade: a cleared focused pass is followed by a full review in one invocation', async () => {
		const { cwd, name, driver, invocations, historyPath, gradePath } = await setupGraded({
			name: 'focused-cleared',
			gaps: [omittedDecisionGap],
			recheckVerdict: closingVerdict,
			edited: 'phase2-extra.md',
		});

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// six readers for the closure, then nine for the whole plan — two passes, one
		// invocation, no second call from the caller
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(15);
		expect(historyScopes({ historyPath })).toStrictEqual(['full', 'focused', 'full']);

		const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

		// the verdict left on disk is the full one, and only a full one may pass
		expect(recorded.scope).toBe('full');
		expect(recorded.passed).toBe(true);
		expect(result.grade.scope).toBe('full');
	});

	test('plan grade: a focused pass with a blocker left runs no full review and cannot pass', async () => {
		const { cwd, name, driver, invocations, historyPath } = await setupGraded({
			name: 'focused-blocked',
			gaps: [omittedDecisionGap],
			edited: 'phase2-extra.md',
		});

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the re-verification judge did not close a single record, so the repair is
		// unproven and the expensive full review is never reached
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(6);
		expect(historyScopes({ historyPath })).toStrictEqual(['full', 'focused']);
		expect(result.grade.scope).toBe('focused');
		expect(result.grade.passed).toBe(false);
		expect(result.grade.complete).toBe(false);
		expect(result.grade.incompleteReason ?? '').toContain('phase2-extra.md');
	});

	test('plan grade: a qualifying full review is reported as current and never repeated', async () => {
		const { cwd, name, gradePath, historyPath, gradeText, historyText } = await setupGraded({ name: 'reused' });
		const driver = createUncalledDriver({ reason: 'a review that already covers these inputs must spawn nothing' });
		const messages: string[] = [];

		const result = await runPlanGrade({ cwd, driver, name, onProgress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		expect(result.reused).toBe(true);
		// the recorded grade is reported as current — and it is still the recorded one
		expect(result.grade.passed).toBe(true);
		expect(readFileSync(gradePath, 'utf8')).toBe(gradeText);
		// nothing was appended either: a reused review is not a pass that ran
		expect(readFileSync(historyPath, 'utf8')).toBe(historyText);
		// and the run says so, naming the one file a human deletes to force a new
		// baseline — a silent skip would read as a pass that ran
		expect(messages).toEqual(expect.arrayContaining([expect.stringContaining(gradeMemoryPath({ cwd, name }))]));
	});

	test('plan grade: changed code invalidates the recorded full review', async () => {
		const { cwd, name, driver, invocations } = await setupGraded({ name: 'code-moved', edited: 'src/alpha.js' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the plan text did not move, but the code it describes did — so the recorded
		// review no longer speaks for the current inputs and every phase is re-read
		expect('reused' in result && result.reused).toBeFalsy();
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md', 'phase3-final.md']);
		expect(result.grade.scope).toBe('full');
		expect(result.grade.focusedOn).toStrictEqual([]);
	});

	test('plan grade: an edited overview forces a full review', async () => {
		const { cwd, name, driver, invocations } = await setupGraded({ name: 'overview-edited', gaps: [omittedDecisionGap], edited: 'overview.md' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the overview is every phase's context, so a change to it can reach any of
		// them and the closure of the edited phases cannot bound it
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md', 'phase3-final.md']);
		expect(result.grade.scope).toBe('full');
		expect(result.grade.focusedOn).toStrictEqual([]);
	});

	test('plan grade: --phase is unchanged by the scope rule', async () => {
		const { cwd, name, driver, invocations, historyPath } = await setupGraded({ name: 'narrowed', gaps: [omittedDecisionGap], edited: 'phase2-extra.md' });

		const result = await runPlanGrade({ cwd, driver, name, phases: ['3'] });

		expectStatus(result, 'complete');
		// the human's narrowing is obeyed exactly — the engine's own closure, which
		// would have read phases 1 and 2, replaces nothing a human typed
		expect(readerPhases({ invocations })).toStrictEqual(['phase3-final.md']);
		expect(result.grade.scope).toBe('full');
		expect(result.grade.focusedOn).toStrictEqual([]);
		// and it is still a subset on its face, so it can never approve
		expect(result.grade.complete).toBe(false);
		expect(result.grade.passed).toBe(false);
		expect(result.grade.incompleteReason ?? '').toMatch(/graded a subset on request: 3/);
		// a narrowed pass is never the reused one either — it ran, and it is recorded
		expect(historyScopes({ historyPath }).length).toBe(2);
	});

	test('plan grade: a grade.json that is not the passing full review is never reused', async () => {
		const { cwd, name, driver, invocations, gradePath } = await setupGraded({ name: 'stale-verdict' });
		const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

		writeFileSync(gradePath, JSON.stringify({ ...recorded, grade: 'below-A', passed: false, complete: false, phasesChecked: [], gaps: [] }));

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the fingerprint still matches, so the memory alone would have vouched for
		// this file — the verdict beside it is what refuses the reuse
		expect('reused' in result && result.reused).toBeFalsy();
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md', 'phase3-final.md']);
		expect(result.grade.passed).toBe(true);
	});

	test('plan grade: the documentation checker runs on full passes only', async () => {
		const { cwd, name, driver, invocations } = await setupGraded({
			name: 'docs-scope',
			gaps: [omittedDecisionGap],
			recheckVerdict: closingVerdict,
			edited: 'phase2-extra.md',
			docs: declaredDocs,
		});

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// two passes ran, and only one of them spawned the whole-plan checker: a
		// checker that reads every file is not part of a pass that reads two
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(15);
		expect(countOf({ invocations, marker: docsCheckMarker })).toBe(1);
		// and the one that spawned it is the full pass, which comes second
		expect(invocations.findIndex(({ prompt }) => prompt.includes(docsCheckMarker))).toBeGreaterThan(5);
		expect(result.grade.scope).toBe('full');
	});
});
