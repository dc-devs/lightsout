import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

test('equivalent acquisitions preserve unknown obligation identity while wider searches create new obligations', async () => {
	const context = await planningEvidenceFixture();
	try {
		await context.write('src/known.ts', 'upload();');
		await context.write('outside/target.ts', 'upload();');
		await symlink(join(context.cwd, 'outside/target.ts'), join(context.cwd, 'src/linked.ts'));
		const initial = await readPlanningEvidence({ runtime: context.runtime, assignmentId: 'investigate', request: context.request });
		const repeated = await readPlanningEvidence({
			runtime: context.runtime,
			assignmentId: 'assurance',
			request: { ...context.request, requestId: 'independent-repeat', reason: 'Challenge the previous conclusion' },
		});
		const wider = await readPlanningEvidence({
			runtime: context.runtime,
			assignmentId: 'assurance',
			request: { ...context.request, requestId: 'broader-scope', roots: ['src', 'outside'] },
		});
		const unknown = initial.evidence.dependencies.find((item) => item.kind === PlanningVocabulary.Dependency.Unknown);
		const broader = wider.evidence.dependencies.find((item) => item.kind === PlanningVocabulary.Dependency.Unknown);
		expectDefined(unknown);
		expectDefined(broader);
		expect(repeated.evidence.dependencies.find((item) => item.kind === PlanningVocabulary.Dependency.Unknown)).toStrictEqual(unknown);
		expect(repeated.evidence.id).not.toBe(initial.evidence.id);
		expect(repeated.evidence.assignmentId).toBe('assurance');
		expect(repeated.evidence.acquisition).toContain('Challenge the previous conclusion');
		expect(broader.id).not.toBe(unknown.id);
		expect(initial.omissions).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/linked.ts' })]));
	} finally {
		await rm(context.cwd, { recursive: true, force: true });
	}
});
