import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, importPlanningWorkspace, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningLegacyFixture, planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ mutation }: { mutation: string }) => {
	const context = await planningStoreFixture();
	directories.push(context.cwd);
	const { cwd, name, record, artifacts } = context;
	const first = await commitPlanningSnapshot({ cwd, name, record, artifacts, expectedRevision: -1, parentDigest: null });
	if (!first.committed) throw new Error('Fixture writer lost');
	const next = structuredClone(record);
	next.revision = 1;
	next.parentDigest = first.snapshot.digest;
	if (mutation === 'confirmation') next.confirmations[0].messageId = 'substituted';
	if (mutation === 'source') next.sources.push({ ...context.origin, text: 'Added source', sha256: sha256({ content: 'Added source' }) });
	if (mutation === 'meaning') next.claims[0].explanation = 'Substituted meaning';
	if (mutation === 'delete') {
		next.claims = [];
		next.artifacts[0].claimIds = [];
	}
	if (mutation === 'provenance') {
		next.sources = [];
		next.claims = [];
		next.artifacts[0].claimIds = [];
	}
	return { ...context, first: first.snapshot, next };
};
const setupLegacy = async ({ renamed = false }: { renamed?: boolean } = {}) => {
	const context = await planningLegacyFixture();
	directories.push(context.cwd);
	const snapshot = await importPlanningWorkspace({ cwd: context.cwd, name: context.name, inputs: context.inputs });
	const record = structuredClone(snapshot.record);
	record.revision++;
	record.parentDigest = snapshot.digest;
	const artifacts = new Map(snapshot.artifacts);
	if (renamed) {
		const phase = record.artifacts.find((item) => item.phaseId === 'stable-2');
		if (phase === undefined) throw new Error('Missing phase fixture');
		artifacts.set('phase2-renamed.md', artifacts.get(phase.path) ?? '');
		artifacts.delete(phase.path);
		phase.path = 'phase2-renamed.md';
	} else {
		record.claims[0].explanation = 'Rewritten historical rationale';
	}
	return { ...context, snapshot, record, artifacts };
};

describe('commitPlanningSnapshot history', () => {
	test.each([
		['confirmation', 'Original confirmation provenance cannot be changed or deleted'],
		['meaning', 'Approved historical claims must preserve their meaning and provenance'],
		['delete', 'Approved historical claims cannot be deleted'],
		['provenance', 'Original input provenance cannot be changed or deleted'],
	])('rejects changes to approved history: %s', async (mutation, message) => {
		const { cwd, name, first, next, artifacts } = await setup({ mutation });

		await expect(commitPlanningSnapshot({ cwd, name, record: next, artifacts, expectedRevision: 0, parentDigest: first.digest })).rejects.toThrow(message);

		expect(await readPlanningSnapshot({ cwd, name })).toStrictEqual(first);
	});
	test('allows additional source evidence without rewriting original approval', async () => {
		const { cwd, name, next, first, artifacts, record } = await setup({ mutation: 'source' });

		const result = await commitPlanningSnapshot({ cwd, name, record: next, artifacts, expectedRevision: 0, parentDigest: first.digest });

		expect(result.committed).toBe(true);
		if (result.committed)
			expect({ sources: result.snapshot.record.sources, claims: result.snapshot.record.claims }).toStrictEqual({
				sources: next.sources,
				claims: record.claims,
			});
	});
	test('prevents a historical decision rationale from changing in a later generation', async () => {
		const { cwd, name, snapshot, record, artifacts } = await setupLegacy();

		await expect(commitPlanningSnapshot({ cwd, name, record, artifacts, expectedRevision: 0, parentDigest: snapshot.digest })).rejects.toThrow(
			'Approved historical claims must preserve their meaning and provenance',
		);
	});
	test('preserves historical phase identity when a current phase filename changes', async () => {
		const { cwd, name, snapshot, record, artifacts } = await setupLegacy({ renamed: true });

		const result = await commitPlanningSnapshot({ cwd, name, record, artifacts, expectedRevision: 0, parentDigest: snapshot.digest });

		expect(result.committed).toBe(true);
		if (result.committed) {
			expect(result.snapshot.record.legacySettlements).toStrictEqual(snapshot.record.legacySettlements);
			expect(result.snapshot.record.artifacts.find((item) => item.variant === PlanningVocabulary.Artifact.Phase && item.phaseId === 'stable-2')?.path).toBe(
				'phase2-renamed.md',
			);
		}
	});
});

const setupSupersession = async ({ variant }: { variant: string }) => {
	const context = await planningStoreFixture();
	directories.push(context.cwd);
	const { cwd, name, record, artifacts, origin } = context;
	const { confirmationId: _confirmation, ...technicalClaim } = record.claims[0];
	const technical = { ...technicalClaim, id: 'technical-old', owner: PlanningVocabulary.Owner.Planner };
	record.claims.push(technical);
	record.claims[0].dependencies = ['technical-old'];
	const initial = await commitPlanningSnapshot({ cwd, name, record, artifacts, expectedRevision: -1, parentDigest: null });
	if (!initial.committed) throw new Error('Fixture writer lost');
	const next = structuredClone(record);
	next.revision = 1;
	next.parentDigest = initial.snapshot.digest;
	next.claims[1].state = PlanningVocabulary.ClaimState.Superseded;
	next.claims.push({ ...technical, id: 'technical-new', supersedes: 'technical-old' });
	next.claims[0].dependencies = ['technical-new'];
	if (variant === 'unrelated') {
		next.claims.push({ ...technical, id: 'unrelated' });
		next.claims[0].dependencies = ['unrelated'];
	}
	if (variant === 'approved-successor' || variant === 'unconfirmed-successor') {
		next.claims[0].state = PlanningVocabulary.ClaimState.Superseded;
		const text = 'Preserve completed uploads and their original timestamps';
		const replacementOrigin = { ...origin, locator: 'Revised requirement', text, sha256: sha256({ content: text }) };
		next.sources.push(replacementOrigin);
		next.confirmations.push({
			...record.confirmations[0],
			id: 'replacement-approval',
			approvedDigest: replacementOrigin.sha256,
			messageText: text,
			messageId: 'message-2',
		});
		next.claims.push({
			...record.claims[0],
			id: 'replacement',
			origin: replacementOrigin,
			text,
			supersedes: 'required',
			dependencies: ['technical-new'],
			owner: variant === 'approved-successor' ? PlanningVocabulary.Owner.User : PlanningVocabulary.Owner.Planner,
			...(variant === 'approved-successor' ? { confirmationId: 'replacement-approval' } : { confirmationId: undefined }),
		});
	}
	return { ...context, initial: initial.snapshot, next };
};
test.each(['redirect', 'approved-successor'])('retains approved meaning through explicit semantic successors: %s', async (variant) => {
	const { cwd, name, initial, next, artifacts } = await setupSupersession({ variant });

	const result = await commitPlanningSnapshot({ cwd, name, record: next, artifacts, expectedRevision: 0, parentDigest: initial.digest });

	expect(result.committed).toBe(true);
	if (result.committed) expect(result.snapshot.record.claims).toStrictEqual(next.claims);
});
test.each(['unrelated', 'unconfirmed-successor'])('rejects unauthorized substitution in approved history: %s', async (variant) => {
	const { cwd, name, initial, next, artifacts } = await setupSupersession({ variant });

	await expect(commitPlanningSnapshot({ cwd, name, record: next, artifacts, expectedRevision: 0, parentDigest: initial.digest })).rejects.toThrow(
		'Approved historical claims must preserve their meaning and provenance',
	);
});
