import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const fixture = await planningEvidenceFixture();
	directories.push(fixture.cwd);
	return { ...fixture, work: { ...fixture.work, role: PlanningVocabulary.Role.Architect } };
};

test('consumed conclusions invalidate permanent inputs without reopening work for unrelated evidence', async () => {
	const { runtime, record, work, request, write } = await setup();
	await write('src/handler.ts', 'upload();');
	const acquired = await readPlanningEvidence({ runtime, assignmentId: 'investigator', request });
	const evidence = { ...acquired.evidence, conclusion: 'Retry preserves the original idempotency key.' };
	record.evidence.push(evidence);
	const architecture = record.claims.find((claim) => claim.id === 'architecture');
	expectDefined(architecture);
	architecture.dependencies.push(evidence.id);
	const before = planningSemanticBasis({ record, work });
	record.evidence.push({ ...evidence, id: 'unrelated', assignmentId: 'other', conclusion: 'An unrelated endpoint times out.' });
	const unrelated = planningSemanticBasis({ record, work, seed: before });
	evidence.conclusion = 'Retry creates a different key and can duplicate the upload.';
	const changed = planningSemanticBasis({ record, work, seed: before });

	expect(before.evidenceIds).toEqual([evidence.id]);
	expect(unrelated.digest).toBe(before.digest);
	expect(changed.digest).not.toBe(before.digest);
	expect(changed.evidenceIds).toEqual(before.evidenceIds);
});

test('architecture inputs track layout meaning while descendant prose and owned layouts remain outputs', async () => {
	const { record, work } = await setup();
	const artifact = record.artifacts.find((item) => item.path === 'plan.md');
	expectDefined(artifact);
	const before = planningSemanticBasis({ record, work });
	const owned = planningSemanticBasis({ record, work, outputPaths: ['plan.md'] });
	artifact.sha256 = sha256({ content: 'New detailed drafting instructions with the same architecture.' });
	const drafted = planningSemanticBasis({ record, work, seed: before });
	artifact.exports.push('ChangedSharedRetryContract');
	const changed = planningSemanticBasis({ record, work, seed: before });
	const ownedAfter = planningSemanticBasis({ record, work, seed: owned });

	expect(drafted.digest).toBe(before.digest);
	expect(changed.digest).not.toBe(before.digest);
	expect(ownedAfter.digest).toBe(owned.digest);
	expect(owned.artifactPaths).toEqual([]);
});
