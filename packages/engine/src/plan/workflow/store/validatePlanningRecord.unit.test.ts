import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, validatePlanningRecord } from '#src/plan/workflow/store/index.ts';
import { planningCompletedFixture } from '#tests/helpers/planningCompletedFixture.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ variant }: { variant: string }) => {
	const { cwd, record } = await planningStoreFixture();
	directories.push(cwd);
	if (variant === 'source') record.sources = [];
	if (variant === 'text') record.claims[0].text = 'Discard completed uploads';
	if (variant === 'confirmation') record.confirmations[0].approvedDigest = 'b'.repeat(64);
	if (variant === 'scope')
		record.confirmations[0].delegation = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['src/allowed'] };
	if (variant === 'phase') record.artifacts[0].variant = PlanningVocabulary.Artifact.Phase;
	if (variant === 'data-phase') record.artifacts[0].phaseId = 'pretend';
	if (variant === 'storage') record.artifacts[0].path = '.planning/commits/file';
	return record;
};

describe('validatePlanningRecord', () => {
	test('accepts exactly bound foreground meaning and provenance', async () => {
		const record = await setup({ variant: 'valid' });

		const result = validatePlanningRecord({ record });

		expect(result).toStrictEqual({ valid: true, issues: [] });
	});
	test.each([
		['source', 'Claim origin does not match a captured source'],
		['text', 'Confirmed claim must retain the exact approved source text'],
		['confirmation', 'Confirmation does not bind this original source'],
		['scope', 'Confirmation delegation does not cover the complete claim scope'],
		['phase', 'Phase artifact requires its stable phase ID'],
		['data-phase', 'Only phase artifacts may establish a phase identity'],
		['storage', 'An artifact cannot replace canonical storage'],
	])('rejects authority or boundary drift: %s', async (variant, message) => {
		const record = await setup({ variant });

		const result = validatePlanningRecord({ record });

		expect(result.valid).toBe(false);
		expect(result.issues.map((issue) => issue.message)).toContain(message);
	});
});

const setupReview = async ({ variant }: { variant: string }) => {
	const context = await planningCompletedFixture();
	directories.push(context.cwd);
	const committed = await commitPlanningSnapshot({ cwd: context.cwd, name: context.name, ...context.candidate });
	if (!committed.committed) throw new Error('Fixture commit lost');
	const record = structuredClone(committed.snapshot.record);
	if (variant === 'unverified') record.reviewReceipts[0].verifiedFindings = [];
	if (variant === 'owner') record.work[1].role = PlanningVocabulary.Role.Draft;
	if (variant === 'withdrawal') {
		record.findings[0].state = PlanningVocabulary.FindingState.Withdrawn;
		record.findings[0].citations = [];
	}
	if (variant === 'running') {
		record.work[1].status = PlanningVocabulary.WorkState.Running;
		record.work[1].currentAttemptId = undefined;
	}
	if (variant === 'complete') record.work[1].currentAttemptId = undefined;
	if (variant === 'result') record.work[1].resultReceiptId = 'missing';
	if (variant === 'evidence') record.evidence[0].uncertaintyIds = ['missing-question'];
	return record;
};
test('accepts independently cited finding resolution and scoped review evidence', async () => {
	const record = await setupReview({ variant: 'valid' });

	const result = validatePlanningRecord({ record });

	expect(result).toStrictEqual({ valid: true, issues: [] });
});
test.each([
	['unverified', 'Verified finding requires matching independent verification'],
	['owner', 'Independent review receipt has an invalid role owner'],
	['withdrawal', 'Withdrawal requires evidence'],
	['running', 'Running work requires an active attempt'],
	['complete', 'Completed work requires an accepted attempt and result receipt'],
	['result', 'Accepted result receipt artifact is missing'],
])('rejects unsupported workflow authority: %s', async (variant, message) => {
	const record = await setupReview({ variant });

	const result = validatePlanningRecord({ record });

	expect(result.valid).toBe(false);
	expect(result.issues.map((issue) => issue.message)).toContain(message);
});

const setupDelegation = async ({ variant }: { variant: string }) => {
	const record = await setup({ variant: 'valid' });
	const claim = record.claims[0];
	const selected = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['src/feature/nested'] };
	claim.scope = selected;
	record.confirmations[0].delegation = { ...selected, packageRoots: ['src/feature'] };
	if (variant === 'explicit') record.confirmations[0].delegation = { ...selected, packageRoots: [], claimIds: ['required'] };
	if (variant === 'outside') claim.scope.packageRoots = ['src/other'];
	if (variant === 'root') record.confirmations[0].delegation.packageRoots = ['.'];
	if (variant === 'unresolved') claim.state = PlanningVocabulary.ClaimState.Unresolved;
	return record;
};
test.each(['nested', 'explicit', 'root'])('accepts explicit and fully contained delegation: %s', async (variant) => {
	const record = await setupDelegation({ variant });

	const result = validatePlanningRecord({ record });

	expect(result).toStrictEqual({ valid: true, issues: [] });
});
test.each(['outside', 'unresolved'])('rejects a claim outside settled delegation: %s', async (variant) => {
	const record = await setupDelegation({ variant });

	const result = validatePlanningRecord({ record });

	expect(result.valid).toBe(false);
	expect(result.issues.length).toBeGreaterThan(0);
});
