import { expect, test } from '@jest/globals';
import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import type { DecisionsRecord, PlanFacts } from '#src/contracts/index.ts';

/** A minimal verified PlanFacts — the ledger brief does not vary with any of it. */
const facts = (): PlanFacts => ({
	request: 'add a foo endpoint',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-07-09T00:00:00.000Z',
});

/** A one-row decisions record, so the assembled prompt is a realistic one. */
const decisions = (): DecisionsRecord => ({
	planName: 'foo-endpoint',
	decisions: [{ source: 'Elicitation', question: 'Which route?', options: 'a / b', choice: 'a', rationale: 'shortest path', assumption: false }],
});

/**
 * A contract spawn, cut down to the acceptance-test ledger brief alone — from
 * its heading to the next section heading — so every assertion below reads the
 * brief the plan writer is handed and nothing from a neighbouring section.
 */
const setupLedgerBrief = () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [{ path: '/repo/.lightsout/plans/foo/plan.md', variant: 'single' as const }],
		limits: { executorFileLimit: 50, createdFileCeiling: 30 },
		contract: true,
	});

	const rest = invocation.prompt.slice(invocation.prompt.indexOf('## Acceptance-test ledger'));
	const nextHeading = rest.search(/\n\n## /);
	const brief = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

	return { brief, rules: brief.split('\n').filter((line) => line.startsWith('- ')) };
};

test('buildPlanWriterInvocation: the ledger brief still refuses a row naming a test the file already holds', () => {
	const { brief } = setupLedgerBrief();

	expect({
		// naming a test file that already exists stays allowed — the permission the
		// move rule is written beside, and the one it must not swallow
		allowsAnExistingTestFile: /may name a test file that already exists/i.test(brief),
		// and the refusal that rides with it survives: a test written for older
		// behaviour is never adopted as a new criterion's verifier
		refusesATestThatFileAlreadyHolds: /may NOT name a test that file already holds/.test(brief),
		statesWhyItIsRefused: /locked in as the verifier of a new/i.test(brief),
		// the two rules are distinct bullets: the refusal is stated before the move
		// bullet opens, not merged into it where a rewrite could drop half of it
		refusalPrecedesTheMoveBullet: brief.indexOf('already holds') < brief.indexOf('- A row may name a test file this plan also lists'),
	}).toEqual({
		allowsAnExistingTestFile: true,
		refusesATestThatFileAlreadyHolds: true,
		statesWhyItIsRefused: true,
		refusalPrecedesTheMoveBullet: true,
	});
});

test('buildPlanWriterInvocation: the ledger brief keeps its four rules, the move rule beside the already-exists rule', () => {
	const { brief, rules } = setupLedgerBrief();

	expect({
		// four rules, each a top-level bullet in the same shape as its neighbours
		ruleCount: rules.length,
		everyRuleIsABullet: rules.every((rule) => rule.startsWith('- A ') || rule.startsWith('- Every ')),
		// the move rule sits directly after the rule about naming an existing file,
		// which is the permission it extends
		movesRuleFollowsTheExistingFileRule: brief.indexOf('already exists') < brief.indexOf('Files to Modify'),
		// and before the escape for a file no test can state, so the two permissions
		// are read together
		movesRulePrecedesTheProseFilesRule: brief.indexOf('Files to Modify') < brief.indexOf('Prose Files'),
		// the other two rules are untouched by the addition
		keepsTheProseFilesRule: /listed under `## Prose Files` instead/.test(brief),
		keepsTheEveryFileReachedRule: /either reached by a row or\n {2}named under `## Prose Files`/.test(brief),
	}).toEqual({
		ruleCount: 4,
		everyRuleIsABullet: true,
		movesRuleFollowsTheExistingFileRule: true,
		movesRulePrecedesTheProseFilesRule: true,
		keepsTheProseFilesRule: true,
		keepsTheEveryFileReachedRule: true,
	});
});
