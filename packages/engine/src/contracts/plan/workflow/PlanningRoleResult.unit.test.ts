import { expect, test } from '@jest/globals';
import { PlanningAnswer, PlanningRoleResult } from '#src/contracts/index.ts';

const setup = () => {
	const hash = 'a'.repeat(64);
	const base = { kind: 'terminal', workId: 'w1', attemptId: 'a1', inputDigest: hash, dependencies: [] };
	const investigation = { ...base, role: 'investigate', claims: [], evidence: [], work: [], findings: [] };
	const review = {
		...base,
		role: 'implementation-review',
		findings: [],
		coverage: { claimIds: ['c1'], phaseIds: ['phase1'], adequacy: 'The failure scenario is explicit.', outcome: 'adequate' },
		verifiedFindings: [],
	};
	return { hash, base, investigation, review };
};

const setupAuthority = ({ variant }: { variant: number }) => {
	const { hash, base, investigation, review } = setup();
	const claim = {
		id: 'c1',
		kind: 'decision',
		text: 'Change the product behavior',
		explanation: 'Proposed',
		contentRevision: 1,
		origin: { artifact: 'notes.md', locator: 'Design', sha256: hash, text: 'Original behavior' },
		owner: 'user',
		state: 'settled',
		dependencies: [],
		scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
		confirmationId: 'invented',
	};
	const work = {
		id: 'proposed-work',
		role: 'draft',
		stage: 'implementation',
		scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
		prerequisiteIds: [],
		inputDigest: hash,
		status: 'complete',
		attemptSequence: 1,
		currentAttemptId: 'invented',
		resultReceiptId: 'invented',
		failureIds: [],
		diagnosisIds: [],
		assignment: 'Write a plan',
	};
	const finding = {
		id: 'f1',
		observationIds: ['o1'],
		scope: work.scope,
		scenario: 'A retry duplicates a completed upload',
		consequence: 'Duplicate records',
		missingObligation: 'Preserve completion',
		severity: 'blocking',
		owner: 'planner',
		state: 'withdrawn',
		resolutionClaimIds: [],
		resolutionArtifacts: [],
		verificationReceiptIds: [],
		citations: [],
	};

	const cases = [
		{ schema: PlanningRoleResult, input: investigation, expected: { success: true, data: investigation } },
		{ schema: PlanningRoleResult, input: review, expected: { success: true, data: review } },
		{ schema: PlanningRoleResult, input: { ...review, artifactEdits: [] }, expected: expect.objectContaining({ success: false }) },
		{
			schema: PlanningRoleResult,
			input: { ...base, role: 'repair', artifactEdits: [], claims: [], resolutions: [], ready: true },
			expected: expect.objectContaining({ success: false }),
		},
		{ schema: PlanningRoleResult, input: { ...investigation, role: 'approve-product' }, expected: expect.objectContaining({ success: false }) },
		{
			schema: PlanningAnswer,
			input: { questionId: 'q1', checkpointRevision: 2, questionDigest: hash, freeText: 'Yes' },
			expected: expect.objectContaining({ success: false }),
		},
		{ schema: PlanningRoleResult, input: { ...investigation, claims: [claim] }, expected: expect.objectContaining({ success: false }) },
		{ schema: PlanningRoleResult, input: { ...investigation, work: [work] }, expected: expect.objectContaining({ success: false }) },
		{ schema: PlanningRoleResult, input: { ...review, findings: [finding] }, expected: expect.objectContaining({ success: false }) },
	];
	return cases[variant];
};

test.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('rejects cross-role authority and stale answer shapes', (variant) => {
	const { schema, input, expected } = setupAuthority({ variant });

	const result = schema.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupAnswer = ({ variant }: { variant: number }) => {
	const confirmation = {
		id: 'confirmed',
		channel: 'foreground',
		messageId: 'message-2',
		messageText: 'Use the recommended retry behavior',
		approvedDigest: 'c'.repeat(64),
		delegation: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
	};
	const base = { questionId: 'q1', checkpointRevision: 2, questionDigest: 'd'.repeat(64), confirmation };
	const selected = { ...base, selectedOption: 'Retry only incomplete uploads' };
	const written = { ...base, freeText: 'Retry only incomplete uploads' };
	const cases = [
		{ input: selected, expected: { success: true, data: selected } },
		{ input: written, expected: { success: true, data: written } },
		{ input: base, expected: expect.objectContaining({ success: false }) },
	];
	return cases[variant];
};

test.each([0, 1, 2])('retains an explicit foreground answer and refuses an empty answer', (variant) => {
	const { input, expected } = setupAnswer({ variant });

	const result = PlanningAnswer.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupHistoricalProposal = () => {
	const { investigation, hash } = setup();
	return {
		...investigation,
		claims: [
			{
				id: 'historical',
				kind: 'decision',
				text: 'Preserve uploads',
				explanation: '',
				contentRevision: 1,
				origin: { artifact: 'decisions.json', locator: '0', sha256: hash, text: 'Preserve uploads' },
				owner: 'planner',
				state: 'unresolved',
				dependencies: [],
				scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
				legacySettlementId: 'forged-history',
			},
		],
	};
};
test('rejects an agent proposal claiming importer-only historical authority', () => {
	const input = setupHistoricalProposal();

	const result = PlanningRoleResult.safeParse(input);

	expect(result.success).toBe(false);
	if (!result.success) expect(JSON.stringify(result.error.issues)).toContain('Role proposals cannot settle user-owned claims');
});

const setupUnstartedProposal = ({ mutation }: { mutation: string }) => {
	const { investigation, hash } = setup();
	const scope = { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] };
	const work = {
		id: 'next',
		role: 'architect',
		stage: 'implementation',
		scope,
		prerequisiteIds: [],
		inputDigest: hash,
		status: 'pending',
		attemptSequence: 0,
		failureIds: [] as string[],
		diagnosisIds: [] as string[],
		assignment: 'Resolve retry contract',
		...(mutation === 'attempt' ? { currentAttemptId: 'forged' } : {}),
		...(mutation === 'receipt' ? { resultReceiptId: 'forged' } : {}),
	};
	if (mutation === 'sequence') work.attemptSequence = 1;
	if (mutation === 'failure') work.failureIds = ['invented'];
	if (mutation === 'diagnosis') work.diagnosisIds = ['invented'];
	const finding = {
		id: 'observation',
		observationIds: ['observed'],
		scope,
		scenario: 'Duplicate writes on retry',
		consequence: 'Duplicate records',
		missingObligation: 'Specify identity',
		severity: 'blocking',
		owner: 'planner',
		state: 'open',
		resolutionClaimIds: [] as string[],
		resolutionArtifacts: [] as string[],
		verificationReceiptIds: [] as string[],
		citations: [],
	};
	if (mutation === 'resolution') finding.resolutionClaimIds = ['invented'];
	if (mutation === 'artifact') finding.resolutionArtifacts = ['plan.md'];
	if (mutation === 'verification') finding.verificationReceiptIds = ['invented'];
	return { ...investigation, work: [work], findings: [finding] };
};
test('retains unstarted proposed work and an unresolved observation exactly', () => {
	const input = setupUnstartedProposal({ mutation: 'valid' });

	const result = PlanningRoleResult.safeParse(input);

	expect(result).toStrictEqual({ success: true, data: input });
});
test.each(['sequence', 'attempt', 'receipt', 'failure', 'diagnosis', 'resolution', 'artifact', 'verification'])(
	'rejects engine-owned metadata in an otherwise valid proposal: %s',
	(mutation) => {
		const input = setupUnstartedProposal({ mutation });

		const result = PlanningRoleResult.safeParse(input);

		expect(result.success).toBe(false);
	},
);

test('retains explicit full-source and artifact coverage without inventing it in a legacy review', () => {
	const { review, hash } = setup();
	const input = { ...review, coverage: { ...review.coverage, sourceDigests: [hash], artifactPaths: ['phase1.md', 'overview.md'] } };
	const result = { current: PlanningRoleResult.parse(input), legacy: PlanningRoleResult.parse(review) };
	expect(result).toStrictEqual({ current: input, legacy: review });
});

test.each([{ sourceDigests: ['invalid'] }, { artifactPaths: ['../outside.md'] }, { artifactPaths: ['/absolute.md'] }, { approved: true }])(
	'rejects malformed coverage rather than silently dropping it: %j',
	(coverage) => {
		const { review } = setup();
		const result = PlanningRoleResult.safeParse({ ...review, coverage: { ...review.coverage, ...coverage } });
		expect(result.success).toBe(false);
	},
);
