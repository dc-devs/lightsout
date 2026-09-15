import { expect, test } from '@jest/globals';
import { PlanningRoleResult } from '#src/contracts/plan/workflow/PlanningRoleResult.ts';

const setup = ({ answerId }: { answerId?: string }) => ({
	kind: 'terminal',
	workId: 'investigate',
	attemptId: 'attempt',
	inputDigest: 'a'.repeat(64),
	role: 'investigate',
	dependencies: [],
	evidence: [],
	work: [],
	findings: [],
	claims: [
		{
			id: 'question',
			kind: 'question',
			text: 'Choose retention behavior',
			explanation: 'An explicit product choice is required',
			contentRevision: 1,
			origin: { artifact: 'notes.md', locator: 'Design', sha256: 'b'.repeat(64), text: 'Choose retention behavior' },
			owner: 'user',
			state: 'unresolved',
			dependencies: [],
			scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
			question: {
				context: 'Completed uploads are retained',
				question: 'Keep completed uploads?',
				options: [],
				recommendation: 'Keep them',
				...(answerId ? { answerId } : {}),
			},
		},
	],
});

test.each(['unrelated-existing-decision', 'new-proposed-alias'])('refuses a role-forged answer link to %s', (answerId) => {
	const proposal = setup({ answerId });

	const result = PlanningRoleResult.safeParse(proposal);

	expect(result.success).toBe(false);
});

test('preserves an unresolved product question without inventing answer authority', () => {
	const proposal = setup({});

	const result = PlanningRoleResult.parse(proposal);

	expect(result).toStrictEqual(proposal);
});
