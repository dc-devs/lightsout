import { expect, test } from '@jest/globals';
import { ledgerBriefOf, writerInvocation } from '#tests/helpers/planWriterInputs.ts';

/**
 * A contract spawn, cut down to the acceptance-test ledger brief alone — from
 * its heading to the next section heading — so every assertion below reads the
 * brief the plan writer is handed and nothing from a neighbouring section.
 */
const setupLedgerBrief = () => {
	const brief = ledgerBriefOf({ prompt: writerInvocation({ contract: true }).prompt });

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

test('buildPlanWriterInvocation: the ledger brief keeps its five rules, the move rule beside the already-exists rule', () => {
	const { brief, rules } = setupLedgerBrief();

	expect({
		// five rules, each a top-level bullet in the same shape as its neighbours
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
		ruleCount: 5,
		everyRuleIsABullet: true,
		movesRuleFollowsTheExistingFileRule: true,
		movesRulePrecedesTheProseFilesRule: true,
		keepsTheProseFilesRule: true,
		keepsTheEveryFileReachedRule: true,
	});
});

test('buildPlanWriterInvocation: a contract repository adds the template rule and the acceptance-test ledger brief', () => {
	const invocation = writerInvocation({
		contract: true,
	});

	// the template's all-variants rule now asks the implementable variants for the table
	expect(invocation.systemPrompt.includes('- **Acceptance tests named, not narrated.**')).toBeTruthy();
	expect(invocation.systemPrompt.includes('An Overview Plan carries neither section')).toBeTruthy();
	// and the prompt carries the brief: the table shape, and the escape for a file no test can state
	expect(invocation.prompt.includes('| Criterion | Test file | Test name | Gate |')).toBeTruthy();
	expect(invocation.prompt.includes('listed under `## Prose Files` instead')).toBeTruthy();
	// the ledger brief sits where the documentation brief sits — before the decisions record
	expect(invocation.prompt.split('\n\n').filter((section) => section.startsWith('## '))).toStrictEqual([
		'## Feature request',
		'## Output files',
		'## Acceptance-test ledger',
		'## Decisions record',
		'## Verified facts',
	]);
});

test('buildPlanWriterInvocation: a repository that writes no contract plans sees no ledger text and no standing token', () => {
	const invocation = writerInvocation();

	// no rule in the template and no brief in the prompt — the invocation is what it
	// was before the key existed
	expect(invocation.systemPrompt.includes('- **Acceptance tests named, not narrated.**')).toBeFalsy();
	expect(invocation.prompt.includes('## Acceptance-test ledger')).toBeFalsy();
	// and the token is substituted away rather than left standing, which the plan
	// lint's unresolved-token scan would otherwise catch in a written plan
	expect(invocation.systemPrompt.includes('{{contractRule}}')).toBeFalsy();
});

test('buildPlanWriterInvocation: the ledger brief allows a row on a file the plan modifies and refuses one on a move source', () => {
	const invocation = writerInvocation({
		contract: true,
	});

	// the ledger brief alone, cut at the next section, so no match can come from
	// a neighbouring section of the prompt
	const ledger = ledgerBriefOf({ prompt: invocation.prompt });

	// the brief is present at all — a missing heading would leave the slice empty
	expect(invocation.prompt.includes('## Acceptance-test ledger')).toBeTruthy();
	// the two change headings a row is now free to name
	expect(ledger).toMatch(/Files to Modify(?! from)/);
	expect(ledger).toMatch(/Files to Modify from Earlier Phases/);
	// and the destination of a move, which is where the test lives once the plan runs
	expect(ledger).toMatch(/destination/i);
	// with the reason that edit is ordinary work: it is reviewed against the plan
	// before the gates run, so the writer is not left guessing why it is allowed
	expect(ledger).toMatch(/review/i);
	// the one case still refused: the source side of a move, which the plan
	// takes away, so the row would point at nothing
	expect(ledger).toMatch(/Files to Move/);
	expect(ledger).toMatch(/moves away|move'?s source|source side/i);
});
