import { describe, expect, test } from '@jest/globals';
import { buildPlanFindingRecheckInvocation } from '#src/agents/index.ts';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';

const setupRecheck = ({ overrides = {} }: { overrides?: Partial<GradeFindingRecord> } = {}) => {
	const planText = '# Phase 1\n\nPLAN-SENTINEL';
	const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
	const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

	const record: GradeFindingRecord = {
		id: 'f3',
		phase: 'phase1-core.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'the plan picks no failure mode',
		decision: 'what to return when the judge times out',
		options: ['throw', 'return null'],
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		humanDecision: 'a human must choose the timeout behaviour',
		reopened: [],
		...overrides,
	};

	return { planText, overviewText, standards, record };
};

describe('buildPlanFindingRecheckInvocation', () => {
	test('the re-verification prompt carries the open record and the current plan text', () => {
		const { planText, overviewText, standards, record } = setupRecheck();

		const { systemPrompt, prompt } = buildPlanFindingRecheckInvocation({ planText, overviewText, standards, record });

		// the marker the shared stub driver tells a re-verification judge by
		expect(prompt.startsWith('# Finding-recheck input')).toBeTruthy();
		expect(prompt.includes('# Gap-judge input')).toBeFalsy();
		expect(prompt.includes('# Gap-check input')).toBeFalsy();
		expect(prompt.includes('# Docs-check input')).toBeFalsy();
		// the current text of the file the question was raised against
		expect(prompt.includes(planText)).toBeTruthy();
		// the one record, with everything the original judge recorded about it
		expect(prompt.includes('f3')).toBeTruthy();
		expect(prompt.includes('omitted-decision')).toBeTruthy();
		expect(prompt.includes('the plan picks no failure mode')).toBeTruthy();
		expect(prompt.includes('what to return when the judge times out')).toBeTruthy();
		expect(prompt.includes('throw')).toBeTruthy();
		expect(prompt.includes('return null')).toBeTruthy();
		expect(prompt.includes('a human must choose the timeout behaviour')).toBeTruthy();
		expect(prompt.includes('one JSON GapVerdict object')).toBeTruthy();
		// the overview and the standards are paid for once, in the cached system prompt
		expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
		expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
		expect(systemPrompt.includes('OVERVIEW-SENTINEL')).toBeTruthy();
		expect(systemPrompt.includes('STANDARDS-SENTINEL')).toBeTruthy();
	});

	test("a phased plan's re-check judge is told where the sibling phase files are", () => {
		const { planText, record } = setupRecheck();

		const { prompt } = buildPlanFindingRecheckInvocation({ planText, planDir: '.lightsout/plans/demo', record });

		// a repair can move the answer into a neighbouring phase, and the judge
		// opens that file itself rather than being handed every phase inline
		expect(prompt.includes("## The plan's other phases")).toBeTruthy();
		expect(prompt.includes('`.lightsout/plans/demo`')).toBeTruthy();
		// the folder is named before the question, so the judge reads where it may
		// look before it reads what it is looking for
		expect(prompt.indexOf("## The plan's other phases")).toBeLessThan(prompt.indexOf('## The question on record'));
	});

	test('a single-file plan gets no sibling-phases section and no context sections at all', () => {
		const { planText, record } = setupRecheck();

		const { systemPrompt, prompt } = buildPlanFindingRecheckInvocation({ planText, record });

		// a single plan has no siblings to open, and a section pointing at its own
		// folder would send the judge looking for phases that do not exist
		expect(prompt.includes("## The plan's other phases")).toBeFalsy();
		expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
		expect(systemPrompt.includes('# Code standards')).toBeFalsy();
		// the brief remains — a judge is never spawned without a job
		expect(systemPrompt.split('\n\n---\n\n').length).toBe(1);
	});

	test('a record with no options and no recorded human decision says so rather than trailing empty', () => {
		const { planText, record } = setupRecheck({ overrides: { options: [], humanDecision: undefined } });

		const { prompt } = buildPlanFindingRecheckInvocation({ planText, record });

		// an empty line reads as evidence the original judge never wrote, and this
		// judge must not mistake a blank for a question with no options offered
		expect(prompt.includes('- options the reader offered: none offered')).toBeTruthy();
		expect(prompt.includes('- what the original judge said a human must settle: not recorded')).toBeTruthy();
	});
});
