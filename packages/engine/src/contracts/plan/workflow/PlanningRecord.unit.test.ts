import { createHash } from 'node:crypto';
import { expect, test } from '@jest/globals';
import { PlanningInput, PlanningRecord, PlanningRoleResult, PlanningRunResult } from '#src/contracts/index.ts';

const setup = () => {
	const text = 'Keep completed uploads when retrying.';
	const sha256 = createHash('sha256').update(text).digest('hex');
	const source = { artifact: 'brainstorm-notes.md', locator: 'Requirements', sha256, text };
	const record = {
		schemaVersion: 1,
		planName: 'retry-upload',
		revision: 0,
		parentDigest: null,
		sources: [source],
		claims: [],
		evidence: [],
		work: [],
		findings: [],
		reviewReceipts: [],
		artifacts: [],
		confirmations: [],
		standards: [],
	};
	return { source, record, sha256 };
};

const setupRecord = ({ variant }: { variant: number }) => {
	const { source, record } = setup();
	const cases = [
		record,
		{ ...record, ready: true },
		{ ...record, sources: [{ ...source, locator: undefined }] },
		{ ...record, confirmations: [{ id: 'forged', messageId: '' }] },
		{ ...record, claims: undefined },
		{ ...record, schemaVersion: 2 },
	];
	return { input: cases[variant], expected: variant === 0 ? { success: true, data: record } : expect.objectContaining({ success: false }) };
};

test.each([0, 1, 2, 3, 4, 5])('rejects forged readiness and malformed planning records', (variant) => {
	const { input, expected } = setupRecord({ variant });

	const result = PlanningRecord.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupContinuation = ({ variant }: { variant: number }) => {
	const { source, sha256 } = setup();
	const request = {
		kind: 'evidence-request',
		role: 'investigate',
		workId: 'w1',
		attemptId: 'a1',
		inputDigest: sha256,
		requests: [{ requestId: 'r1', operation: 'read-file', path: 'src/upload.ts', reason: 'Verify retry identity' }],
	};
	const input = { stage: 'brainstorm', sources: [source], claims: [], confirmations: [] };
	const cases = [
		{ schema: PlanningRoleResult, input: request, expected: { success: true, data: request } },
		{ schema: PlanningRoleResult, input: { ...request, ready: true }, expected: expect.objectContaining({ success: false }) },
		{ schema: PlanningRoleResult, input: { ...request, completed: true }, expected: expect.objectContaining({ success: false }) },
		{ schema: PlanningInput, input, expected: { success: true, data: input } },
		{ schema: PlanningInput, input: { ...input, sources: [{ ...source, text: 'Different intent' }] }, expected: expect.objectContaining({ success: false }) },
		{
			schema: PlanningInput,
			input: { ...input, confirmations: [{ channel: 'model', messageId: 'invented' }] },
			expected: expect.objectContaining({ success: false }),
		},
	];
	return cases[variant];
};

test.each([0, 1, 2, 3, 4, 5])('parses evidence continuation and foreground input distinctly', (variant) => {
	const { schema, input, expected } = setupContinuation({ variant });

	const result = schema.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupRange = ({ reversed }: { reversed: boolean }) => {
	const { sha256 } = setup();
	const input = {
		kind: 'evidence-request',
		role: 'investigate',
		workId: 'w1',
		attemptId: 'a1',
		inputDigest: sha256,
		requests: [{ requestId: 'r2', operation: 'read-range', path: 'src/upload.ts', startLine: 20, endLine: reversed ? 10 : 25, reason: 'Inspect retry loop' }],
	};
	return { input, expected: reversed ? expect.objectContaining({ success: false }) : { success: true, data: input } };
};

test.each([false, true])('retains a precise requested source range and rejects reversed ranges', (reversed) => {
	const { input, expected } = setupRange({ reversed });

	const result = PlanningRoleResult.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupCompletion = ({ variant }: { variant: number }) => {
	const { sha256 } = setup();
	const readiness = {
		target: 'implementation',
		ready: true,
		generation: sha256,
		inputDigest: sha256,
		structuralFailures: [],
		uncoveredClaimIds: [],
		openBlockerIds: [],
		unresolvedQuestionIds: [],
		integrationReceiptId: 'integration-1',
	};
	const complete = { status: 'complete', name: 'retry-upload', generation: sha256, deliverables: ['plan.md'], readiness };
	const aligned = {
		status: 'aligned',
		name: 'retry-upload',
		generation: sha256,
		sourceDigest: sha256,
		confirmationId: 'confirmation-1',
		challengeReceiptId: 'challenge-1',
		readiness: { ...readiness, target: 'brainstorm-alignment', integrationReceiptId: undefined },
	};
	const cases = [
		{ input: complete, expected: { success: true, data: complete } },
		{ input: aligned, expected: { success: true, data: aligned } },
		{ input: { ...complete, generation: 'e'.repeat(64) }, expected: expect.objectContaining({ success: false }) },
		{ input: { ...complete, readiness: { ...readiness, target: 'brainstorm-alignment' } }, expected: expect.objectContaining({ success: false }) },
		{ input: { ...complete, readiness: { ...readiness, ready: false } }, expected: expect.objectContaining({ success: false }) },
	];
	return cases[variant];
};

test.each([0, 1, 2, 3, 4])('binds completion to its generation and keeps brainstorm alignment distinct', (variant) => {
	const { input, expected } = setupCompletion({ variant });

	const result = PlanningRunResult.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupReviewer = ({ selfReview }: { selfReview: boolean }) => {
	const { record, sha256 } = setup();
	const receipt = {
		id: 'review-1',
		workId: 'review-work',
		attemptId: selfReview ? 'author-attempt' : 'reviewer-attempt',
		authorAttemptIds: ['author-attempt'],
		role: 'implementation-review',
		inputDigest: sha256,
		coverage: { claimIds: [], phaseIds: [], adequacy: 'Reviewed the complete retry contract', outcome: 'adequate' },
		dependencies: [],
		issuer: { agent: 'reviewer', invocationId: 'invocation-2' },
		findingIds: [],
		verifiedFindings: [],
		completedAt: '2026-09-14T12:00:00.000Z',
	};
	const input = { ...record, reviewReceipts: [receipt] };
	return { input, expected: selfReview ? expect.objectContaining({ success: false }) : { success: true, data: input } };
};

test.each([false, true])('requires a distinct reviewing attempt in persisted review evidence', (selfReview) => {
	const { input, expected } = setupReviewer({ selfReview });

	const result = PlanningRecord.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupHistoricalInput = () => {
	const { source, record, sha256 } = setup();
	const scope = { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] };
	const claim = {
		id: 'legacy',
		kind: 'decision',
		text: source.text,
		explanation: '',
		contentRevision: 1,
		origin: source,
		owner: 'user',
		state: 'settled',
		dependencies: [],
		scope,
		legacySettlementId: 'receipt',
	};
	const settlement = {
		id: 'receipt',
		format: 'legacy-decision-v1',
		planName: record.planName,
		claimId: claim.id,
		sourcePath: 'decisions.json',
		artifact: 'planning-originals/decisions.json',
		artifactDigest: sha256,
		rowIndex: 0,
		rowText: '{}',
		rowDigest: sha256,
		choiceDigest: sha256,
		scope,
		phaseBindings: [],
	};
	return {
		record: { ...record, claims: [claim], legacySettlements: [settlement] },
		input: { stage: 'brainstorm', sources: [source], claims: [claim], confirmations: [] },
	};
};
test('preserves historical record fields without minting foreground authority', () => {
	const { record, input } = setupHistoricalInput();

	const result = { record: PlanningRecord.safeParse(record), input: PlanningInput.safeParse(input) };

	expect(result.record).toStrictEqual({ success: true, data: record });
	expect(result.input.success).toBe(false);
	if (!result.input.success) expect(result.input.error.issues.map((issue) => issue.message)).toContain('Foreground input cannot mint historical settlement');
});

const setupForegroundClaim = () => {
	const { source } = setup();
	const scope = { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] };
	return {
		stage: 'brainstorm',
		sources: [source],
		claims: [
			{
				id: 'required',
				kind: 'requirement',
				text: source.text,
				explanation: '',
				contentRevision: 1,
				origin: source,
				owner: 'user',
				state: 'settled',
				dependencies: [],
				scope,
				confirmationId: 'foreground',
			},
		],
		confirmations: [
			{ id: 'foreground', channel: 'foreground', messageId: 'original-message', messageText: source.text, approvedDigest: source.sha256, delegation: scope },
		],
	};
};
test('retains a foreground claim and its explicit confirmation without historical authority', () => {
	const input = setupForegroundClaim();

	const result = PlanningInput.safeParse(input);

	expect(result).toStrictEqual({ success: true, data: input });
});
