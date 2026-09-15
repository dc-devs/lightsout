import { describe, expect, test } from '@jest/globals';
import { runPlanDraft } from '#src/plan/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

describe('runPlanDraft', () => {
	test('routes a claimed canonical repair through one transactional focused invocation', async () => {
		const fixture = await planningDraftFixture({ repair: true });

		const result = await runPlanDraft({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });

		expect(result).toEqual(expect.objectContaining({ role: 'repair', kind: 'terminal', workId: fixture.work.id, attemptId: fixture.work.currentAttemptId }));
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.calls[0]?.systemPrompt).toContain('transactional artifactEdits');
		expect(fixture.snapshot.artifacts.get('phase1-original.md')).toBe(fixture.proseA);
		expect(fixture.snapshot.artifacts.get('phase3-report.md')).toBe(fixture.proseC);
	});
});
