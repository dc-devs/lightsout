import { readFile } from 'node:fs/promises';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningQuestionScenario } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

test.each(['meaning', 'source'])('refuses a checkpoint when its %s changes during publication', async (variant) => {
	const fixture = await planningQuestionScenario();
	await fixture.capture();
	let raced = false;
	let callsAtRace = 0;
	fixture.runtime.storeIO = {
		checkpoint: async ({ operation, path }) => {
			if (operation !== 'candidate' || raced) return;
			const candidate = JSON.parse(await readFile(path, 'utf8'));
			if (!candidate.record.artifacts.some((artifact: { path: string }) => artifact.path.startsWith('planning-questions/'))) return;
			raced = true;
			callsAtRace = fixture.calls.length;
			const current = await readPlanningSnapshot(fixture);
			if (!current) throw new Error('Expected current question');
			const record = structuredClone(current.record);
			record.revision++;
			record.parentDigest = current.digest;
			if (variant === 'meaning') {
				const question = record.claims.find((claim) => claim.kind === 'question' && claim.state === 'unresolved');
				if (question?.kind !== 'question') throw new Error('Expected unresolved question');
				question.question.context += ' Concurrently discovered conflict with metadata retention.';
				question.contentRevision++;
			} else {
				const text = 'Preserve metadata as well as bytes.';
				record.sources.push({ artifact: 'metadata.txt', locator: 'Additional original context', text, sha256: sha256({ content: text }) });
			}
			const winner = await commitPlanningSnapshot({
				...fixture,
				record,
				artifacts: current.artifacts,
				expectedRevision: current.record.revision,
				parentDigest: current.digest,
			});
			if (!winner.committed) throw new Error('Expected concurrent checkpoint competitor');
		},
	};
	await expect(runPlanning({ runtime: fixture.runtime })).rejects.toThrow(variant === 'meaning' ? 'Question meaning changed' : 'Question sources changed');
	const after = await readPlanningSnapshot(fixture);
	expect(raced).toBe(true);
	expect(fixture.calls).toHaveLength(callsAtRace);
	expect(after?.record.artifacts.some((artifact) => artifact.path.startsWith('planning-questions/'))).toBe(false);
	const resumed = await runPlanning({ runtime: fixture.runtime });
	expect(resumed.status).toBe('awaiting-user');
	expect(fixture.calls).toHaveLength(callsAtRace);
	if (variant === 'meaning' && resumed.status === 'awaiting-user') expect(resumed.question.context).toContain('Concurrently discovered conflict');
	if (variant === 'source') expect(after?.record.sources.some((source) => source.artifact === 'metadata.txt')).toBe(true);
});
