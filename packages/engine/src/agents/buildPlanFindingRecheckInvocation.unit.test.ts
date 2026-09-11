import { describe, expect, test } from '@jest/globals';
import { buildPlanFindingRecheckInvocation } from '#src/agents/index.ts';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';

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
		observations: [],
		resolutions: [],
		reopened: [],
		...overrides,
	};

	return { planText, overviewText, standards, record };
};

/**
 * One re-check spawn of a record that spans the first `spans` of three plan
 * files, covering the location at `covered`. Every observation's wording differs
 * from the record's representative fields, so a builder that printed the
 * representative where the covered location's own wording belongs — or swapped
 * wording in on a record that spans one file — is caught. The plan text names no
 * plan file, so any file name in the prompt was put there by the builder.
 */
const setupLocationSpawn = ({ spans, covered }: { spans: number; covered: number }) => {
	const observations: GapObservation[] = [
		{
			phase: 'phase1-core.md',
			lens: GapCheckLens.Decisions,
			area: GapArea.OmittedDecision,
			gap: 'the core raises no error when a judge times out',
			decision: 'which error the core raises on a judge timeout',
			options: ['throw', 'return null'],
		},
		{
			phase: 'phase2-runner.md',
			lens: GapCheckLens.Wiring,
			area: GapArea.PhaseSeamMismatch,
			gap: 'the runner catches a timeout error the core never raises',
			decision: 'which phase owns the timeout error',
			options: [],
		},
		{
			phase: 'phase3-cli.md',
			lens: GapCheckLens.Surface,
			area: GapArea.UnderspecifiedSurface,
			gap: 'the command prints nothing for a timed-out judge',
			decision: 'what the command prints on a judge timeout',
			options: [],
		},
	];
	const spanned = observations.slice(0, spans);
	const { record } = setupRecheck({ overrides: { observations: spanned } });
	const { record: singleRecord } = setupRecheck();
	const planText = '# Covered phase\n\nCOVERED-PLAN-SENTINEL';

	return { planText, record, singleRecord, observation: spanned[covered], locations: spanned.map(({ phase }) => phase) };
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

	test("leaves a one-location record's prompt unchanged even though an observation is passed", () => {
		const { planText, record, observation, locations } = setupLocationSpawn({ spans: 1, covered: 0 });

		const withLocation = buildPlanFindingRecheckInvocation({ planText, record, observation, locations });
		const withNeither = buildPlanFindingRecheckInvocation({ planText, record });

		// verifyOpenFindings passes an observation on every spawn, so its presence
		// says nothing: a single-entry location list gates nothing on, and the prompt
		// neither swaps in the observation's wording nor claims another location
		expect(withLocation).toStrictEqual(withNeither);
	});

	test("names the covered file and the record's other locations on a multi-location spawn", () => {
		const { planText, record, observation, locations } = setupLocationSpawn({ spans: 3, covered: 1 });

		const { prompt } = buildPlanFindingRecheckInvocation({ planText, record, observation, locations });
		const question = prompt.slice(prompt.indexOf('## The question on record'));

		// the question is asked in the covered location's own words, under the record's id
		expect(question.includes('f3')).toBeTruthy();
		expect(question.includes('phase-seam-mismatch')).toBeTruthy();
		expect(question.includes('the runner catches a timeout error the core never raises')).toBeTruthy();
		expect(question.includes('which phase owns the timeout error')).toBeTruthy();
		// never in the representative's, which describes a different plan file
		expect(question.includes('omitted-decision')).toBeFalsy();
		expect(question.includes('the plan picks no failure mode')).toBeFalsy();
		expect(question.includes('what to return when the judge times out')).toBeFalsy();
		// one line names the file this spawn covers and both of the record's other locations
		expect(
			prompt.split('\n').some((line) => line.includes('phase2-runner.md') && line.includes('phase1-core.md') && line.includes('phase3-cli.md')),
		).toBeTruthy();
	});

	test("states the location's own wording when one observation is supplied", () => {
		const { planText, record, singleRecord, observation, locations } = setupLocationSpawn({ spans: 2, covered: 1 });

		const today = buildPlanFindingRecheckInvocation({ planText, record: singleRecord });
		const located = buildPlanFindingRecheckInvocation({ planText, record, observation, locations });
		const question = located.prompt.slice(located.prompt.indexOf('## The question on record'));

		// a one-location record with no observation argument gets exactly the prompt
		// the builder produced before grouping existed
		expect(today.prompt).toBe(
			[
				'# Finding-recheck input',
				'## The plan as it reads now\n\n# Covered phase\n\nCOVERED-PLAN-SENTINEL',
				[
					'## The question on record',
					'',
					'- record: f3',
					'- area: omitted-decision',
					'- finding: the plan picks no failure mode',
					'- the reader says this must be decided: what to return when the judge times out',
					'- options the reader offered: throw / return null',
					'- what the original judge said a human must settle: a human must choose the timeout behaviour',
				].join('\n'),
				'Remember: your entire final message must be exactly one JSON GapVerdict object — nothing else.',
			].join('\n\n'),
		);
		// a spawn over one location of a record that spans two asks in that location's own words
		expect(question.includes('the runner catches a timeout error the core never raises')).toBeTruthy();
		expect(question.includes('which phase owns the timeout error')).toBeTruthy();
		expect(question.includes('the plan picks no failure mode')).toBeFalsy();
		// and names the plan file it covers, which the plan text itself never does
		expect(located.prompt.includes('phase2-runner.md')).toBeTruthy();
	});
});
