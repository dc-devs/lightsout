import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, type PlanningReviewReceipt, PlanningVocabulary } from '#src/contracts/index.ts';
import { fingerprintPlanningDependencies } from '#src/plan/workflow/evidence/index.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	return context;
};
const setupPath = async ({ kind, present }: { kind: 'content' | 'absence'; present: 'file' | 'directory' | 'absent' }) => {
	const context = await setup();
	const path = 'src/future';
	const dependency: PlanningDependency = kind === 'content' ? { id: 'source', kind, path, sha256: sha256({ content: 'prior' }) } : { id: 'source', kind, path };
	if (present === 'file') await context.write(path, 'new');
	if (present === 'directory') await mkdir(join(context.cwd, path), { recursive: true });
	return { ...context, dependencies: [dependency] };
};
test.each([
	{ kind: 'content' as const, present: 'absent' as const, expected: 'absence', current: false },
	{ kind: 'absence' as const, present: 'absent' as const, expected: 'absence', current: true },
	{ kind: 'absence' as const, present: 'file' as const, expected: 'content', current: false },
	{ kind: 'absence' as const, present: 'directory' as const, expected: 'membership', current: false },
])('refreshes $kind when the source becomes $present', async ({ kind, present, expected, current }) => {
	const context = await setupPath({ kind, present });

	const result = await fingerprintPlanningDependencies(context);

	expect(result.current).toBe(current);
	expect(result.dependencies[0].kind).toBe(expected);
	expect(result.changed).toStrictEqual(current ? [] : ['source']);
});
const setupDirect = async ({ missing = false, linked = false }: { missing?: boolean; linked?: boolean } = {}) => {
	const context = await setup();
	const root = 'src';
	if (!missing) {
		await context.write('src/source.ts', 'excluded source');
		await context.write('src/visible.ts', 'visible source');
		await mkdir(join(context.cwd, 'src/nested'));
	}
	if (linked) await symlink(join(context.cwd, 'package.json'), join(context.cwd, 'src/linked'));
	const dependencies: PlanningDependency[] = [
		{
			id: 'members',
			kind: PlanningVocabulary.Dependency.Membership,
			root,
			policy: { exclude: ['src/source.ts'], recursive: false },
			fingerprint: sha256({ content: 'prior' }),
		},
	];
	return { ...context, dependencies };
};
test.each([
	{ missing: true, linked: false },
	{ missing: false, linked: false },
	{ missing: false, linked: true },
])('refreshes direct membership with missing=$missing and links=$linked', async ({ missing, linked }) => {
	const context = await setupDirect({ missing, linked });

	const result = await fingerprintPlanningDependencies(context);

	expect(result.current).toBe(false);
	expect(result.changed).toStrictEqual(['members']);
	expect(result.unknown).toBe(linked);
	expect(result.dependencies[0]).toEqual(expect.objectContaining({ kind: 'membership', policy: { exclude: ['src/source.ts'], recursive: false } }));
});
const setupLegacyUnknown = async () => {
	const context = await setup();
	const dependencies: PlanningDependency[] = [
		{
			id: 'unobserved',
			kind: PlanningVocabulary.Dependency.Unknown,
			roots: ['.'],
			reason: 'Older harness reads were not observed',
			fallbackFingerprint: sha256({ content: 'prior' }),
		},
	];
	return { ...context, dependencies };
};
test('broadens a legacy unknown dependency with an explicit current policy', async () => {
	const context = await setupLegacyUnknown();

	const result = await fingerprintPlanningDependencies(context);

	expect(result.current).toBe(false);
	expect(result.unknown).toBe(true);
	expect(result.dependencies[0]).toEqual(
		expect.objectContaining({ policy: { exclude: ['.git', '.git/**', '.lightsout', '.lightsout/**'], identity: expect.any(String) } }),
	);
});
const setupClaimCollection = async () => {
	const context = await setup();
	const dependency: PlanningDependency = {
		id: 'claims',
		kind: PlanningVocabulary.Dependency.Collection,
		collection: PlanningVocabulary.Collection.Claims,
		scope: JSON.stringify(context.scope),
		memberDigests: {},
	};
	const captured = await fingerprintPlanningDependencies({ ...context, dependencies: [dependency] });
	const record = structuredClone(context.record);
	record.claims[0].text = 'A changed obligation';
	return { ...context, record, dependencies: captured.dependencies };
};
test('invalidates a semantic collection after a captured obligation changes', async () => {
	const context = await setupClaimCollection();

	const result = await fingerprintPlanningDependencies(context);

	expect(result.current).toBe(false);
	expect(result.changed).toStrictEqual(['claims']);
});

const setupReviews = async () => {
	const context = await setup();
	const selectedScope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['packages/web'] };
	const record = structuredClone(context.record);
	record.work.push(
		{ ...context.work, id: 'web-review', scope: selectedScope },
		{ ...context.work, id: 'other-review', scope: { ...selectedScope, packageRoots: ['packages/server'] } },
	);
	const receipt = (workId: string): PlanningReviewReceipt => ({
		id: workId,
		workId,
		attemptId: `${workId}-attempt`,
		authorAttemptIds: ['author-attempt'],
		role: PlanningVocabulary.Role.ImplementationReview,
		inputDigest: context.work.inputDigest,
		coverage: { claimIds: [], phaseIds: [], adequacy: 'Reviewed scoped contracts', outcome: PlanningVocabulary.Review.Adequate },
		dependencies: [],
		issuer: { agent: 'independent-test-reviewer', invocationId: workId },
		findingIds: [],
		verifiedFindings: [],
		completedAt: '2026-09-14T00:00:00.000Z',
	});
	record.reviewReceipts.push(receipt('web-review'), receipt('other-review'), receipt('missing-owner'));
	const dependencies: PlanningDependency[] = [
		{
			id: 'reviews',
			kind: PlanningVocabulary.Dependency.Collection,
			collection: PlanningVocabulary.Collection.Reviews,
			scope: JSON.stringify(selectedScope),
			memberDigests: {},
		},
	];
	return { ...context, record, dependencies };
};
test('selects reviews by owner scope and conservatively retains an unresolved owner', async () => {
	const context = await setupReviews();

	const result = await fingerprintPlanningDependencies(context);

	expect(result.dependencies[0]).toEqual(
		expect.objectContaining({
			memberDigests: {
				'web-review': expect.any(String),
				'missing-owner': expect.any(String),
			},
		}),
	);
	expect(result.changed).toStrictEqual(['reviews']);
});
