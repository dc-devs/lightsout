import { expect, test } from '@jest/globals';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const lens = GapCheckLens.Surface;

test('buildPlanGapCheckInvocation: the system prompt carries the role, the lens brief, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	// the shared role prompt leads the system prompt, and the lens brief follows it
	expect(systemPrompt.startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(systemPrompt.includes('# Your brief: surface')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not grade standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`),
	).toBeTruthy();
});

test('buildPlanGapCheckInvocation: each lens gets its own brief, and only its own', () => {
	const briefs = [GapCheckLens.Surface, GapCheckLens.Wiring, GapCheckLens.Decisions].map(
		(each) => buildPlanGapCheckInvocation({ planText, lens: each }).systemPrompt,
	);

	expect(briefs[0].includes('# Your brief: surface')).toBeTruthy();
	expect(briefs[1].includes('# Your brief: wiring')).toBeTruthy();
	expect(briefs[2].includes('# Your brief: decisions')).toBeTruthy();
	// a checker told to own one brief must not be handed a second one, or the
	// narrowing the three-lens fan-out depends on is gone
	expect(briefs[0].includes('# Your brief: wiring')).toBeFalsy();
	expect(briefs[1].includes('# Your brief: decisions')).toBeFalsy();
	expect(briefs[2].includes('# Your brief: surface')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, lens });

	// no overview section for a single-file plan
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: role, brief, overview, and standards are joined in that order by a `---` rule', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	const sections = systemPrompt.split('\n\n---\n\n');

	// exactly four sections, each separated by a horizontal rule
	expect(sections.length).toBe(4);
	expect(sections[0].startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(sections[1].startsWith('# Your brief: surface')).toBeTruthy();
	expect(sections[2]).toBe(`# Overview (context only — do not grade standalone)\n\n${overviewText}`);
	expect(sections[3]).toBe(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
});

test('buildPlanGapCheckInvocation: the system prompt is byte-identical across the spawns of one lens', () => {
	const first = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });
	const second = buildPlanGapCheckInvocation({ planText: '# Phase 2\n\nsomething else entirely', overviewText, standards, lens });

	// only the plan under check varies between the phase spawns sharing a lens,
	// which is what the harness's prompt cache is paid for
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapCheckInvocation: the user prompt is the plan under check plus the report reminder — nothing cacheable', () => {
	const { prompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	// the marker runPlanGrade keys gap-check invocations off
	expect(prompt.startsWith('# Gap-check input')).toBeTruthy();
	expect(prompt.includes(`## Plan to check\n\n${planText}`)).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON GapCheckReport object')).toBeTruthy();
	// the overview is paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
	// and the lens never leaks into the per-spawn half either
	expect(prompt.includes('# Your brief')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: the standards section follows the brief directly when no overview is given', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, standards, lens });

	const sections = systemPrompt.split('\n\n---\n\n');

	// role, brief and standards only — the two optional sections are gated independently
	expect(sections.length).toBe(3);
	expect(sections[0].startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(sections[1].startsWith('# Your brief: surface')).toBeTruthy();
	expect(sections[2]).toBe(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
});

test('buildPlanGapCheckInvocation: the wiring lens is told where the sibling phase files live', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, planDir: '.lightsout/plans/web-app', lens: GapCheckLens.Wiring });

	const sections = systemPrompt.split('\n\n---\n\n');

	// the folder section sits between the brief it serves and the overview
	expect(sections.length).toBe(5);
	expect(sections[2].startsWith("# The plan's other phases")).toBeTruthy();
	expect(sections[2].includes('`.lightsout/plans/web-app`')).toBeTruthy();
});

test('buildPlanGapCheckInvocation: the other two lenses are never handed the plan folder', () => {
	for (const each of [GapCheckLens.Surface, GapCheckLens.Decisions]) {
		const { systemPrompt } = buildPlanGapCheckInvocation({ planText, planDir: '.lightsout/plans/web-app', lens: each });

		// their briefs push seam work to wiring — a folder they are told to leave
		// alone is an invitation to wander outside the brief
		expect(systemPrompt.includes("# The plan's other phases")).toBeFalsy();
	}
});

test('buildPlanGapCheckInvocation: a single-file plan names no folder, so the wiring lens gets no siblings section', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, lens: GapCheckLens.Wiring });

	const sections = systemPrompt.split('\n\n---\n\n');

	// a single plan has no siblings to open, and a section pointing at its own
	// folder would send the checker looking for phases that do not exist — the
	// wiring brief's own `##` seam section stays, but no `#` role section joins it
	expect(sections.length).toBe(2);
	expect(sections[1].startsWith('# Your brief: wiring')).toBeTruthy();
});

test('buildPlanGapCheckInvocation: the wiring system prompt stays byte-identical across the spawns of one pass', () => {
	const planDir = '.lightsout/plans/web-app';
	const first = buildPlanGapCheckInvocation({ planText, overviewText, standards, planDir, lens: GapCheckLens.Wiring });
	const second = buildPlanGapCheckInvocation({ planText: '# Phase 2\n\nsomething else entirely', overviewText, standards, planDir, lens: GapCheckLens.Wiring });

	// the folder is per-pass, not per-phase, so it lives in the cached half
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapCheckInvocation: an empty overview and empty standards add no sections', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText: '', standards: '', lens });

	// empty text is nothing to grade against, so neither heading is emitted
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
	// the role and its brief remain — a checker is never spawned without a job
	expect(systemPrompt.split('\n\n---\n\n').length).toBe(2);
});

const settledRecords: GradeFindingRecord[] = [
	{
		id: 'f1',
		phase: 'phase1-memory.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'RESOLVED-GAP-SENTINEL: the retry budget is never stated',
		decision: 'How many retries does the runner get?',
		options: ['one', 'three'],
		firstSeen: '2026-01-01T00:00:00.000Z',
		lastSeen: '2026-01-02T00:00:00.000Z',
		status: GradeFindingStatus.Resolved,
		disposition: GapOutcome.NeedsAHuman,
		humanDecision: 'the human picks the retry budget',
		resolution: { answerAt: 'RESOLUTION-CITATION-SENTINEL: the runner retries three times', verifiedAt: '2026-01-02T00:00:00.000Z' },
		reopened: [],
	},
	{
		id: 'f2',
		phase: 'phase1-memory.md',
		lens: GapCheckLens.Surface,
		area: GapArea.InsufficientDetail,
		gap: 'NOTED-GAP-SENTINEL: the helper is unnamed',
		decision: 'What is the helper called?',
		options: [],
		firstSeen: '2026-01-01T00:00:00.000Z',
		lastSeen: '2026-01-02T00:00:00.000Z',
		status: GradeFindingStatus.Noted,
		disposition: GapOutcome.AgentCanDecide,
		agentDecision: 'AGENT-DECISION-SENTINEL: name it toRetryDelay',
		safeBecause: 'the name has one caller',
		reopened: [],
	},
];

test("the settled-findings section carries the phase's resolved and noted records", () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens, settled: settledRecords });

	const sections = systemPrompt.split('\n\n---\n\n');
	const settledSection = sections[2];

	// the settled list sits between the brief it qualifies and the overview
	expect(sections.length).toBe(5);
	expect(settledSection.startsWith('# Findings already settled for this plan file')).toBeTruthy();
	// each record is named by its id, so a reader can point at the one it means
	expect(settledSection.includes('f1')).toBeTruthy();
	expect(settledSection.includes('f2')).toBeTruthy();
	// the question each record settled
	expect(settledSection.includes('RESOLVED-GAP-SENTINEL: the retry budget is never stated')).toBeTruthy();
	expect(settledSection.includes('NOTED-GAP-SENTINEL: the helper is unnamed')).toBeTruthy();
	// and how it was settled — the citation for a resolved record, the agent's
	// decision for a noted one, which is what makes re-reporting it cost evidence
	expect(settledSection.includes('RESOLUTION-CITATION-SENTINEL: the runner retries three times')).toBeTruthy();
	expect(settledSection.includes('AGENT-DECISION-SENTINEL: name it toRetryDelay')).toBeTruthy();
	// the section is context, not coverage: the lens is still read end to end
	expect(sections[1].startsWith('# Your brief: surface')).toBeTruthy();
});

test('a settled record with no citation and no agent decision still says it was settled', () => {
	const answered: GradeFindingRecord = { ...settledRecords[1], agentDecision: undefined, disposition: GapOutcome.AlreadyAnswered };
	const settled: GradeFindingRecord[] = [
		{ ...answered, id: 'f4', answerAt: 'ANSWER-AT-SENTINEL: Decision Log row 9' },
		{ ...answered, id: 'f5' },
	];

	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, lens, settled });

	// the three ways a record can carry its settlement, and the line a record
	// carrying none of them falls back to — a blank there would read as a record
	// nobody settled, which is exactly what a settled list must not say
	expect(systemPrompt.includes('f4 (noted) — NOTED-GAP-SENTINEL: the helper is unnamed — settled by: ANSWER-AT-SENTINEL: Decision Log row 9')).toBeTruthy();
	expect(systemPrompt.includes('f5 (noted) — NOTED-GAP-SENTINEL: the helper is unnamed — settled by: settled by an earlier pass')).toBeTruthy();
});

test('a plan file the memory has settled nothing for gets no settled section', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens, settled: [] });

	const sections = systemPrompt.split('\n\n---\n\n');

	// an empty list section would tell a reader the memory holds settlements for
	// this file when it holds none. The role brief's own `##` heading explains the
	// list and always stays, so the claim is that no SECTION is the list.
	expect(sections.some((section) => section.startsWith('# Findings already settled for this plan file'))).toBeFalsy();
	expect(sections.length).toBe(4);
});
