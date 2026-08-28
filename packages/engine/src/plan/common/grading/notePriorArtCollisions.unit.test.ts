import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { DedupReport } from '#src/contracts/index.ts';
import { notePriorArtCollisions } from '#src/plan/common/grading/notePriorArtCollisions.ts';
import { seedDedupPlan } from '#tests/helpers/seedDedupPlan.ts';

// The nudge argues one thing: there are collisions no dedup pass has weighed.
// So what it does with `dedup.json` is the whole of its behaviour.

/** A repo whose planned `src/getUser.ts` collides with an existing `src/fetchUser.ts`, plus the collector the nudge writes into. */
const setup = () => {
	const { cwd, name, workspaceDir } = seedDedupPlan({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const messages: string[] = [];

	return {
		cwd,
		name,
		workspaceDir,
		messages,
		planPaths: [join(workspaceDir, 'plan.md')],
		onProgress: (message: string) => messages.push(message),
	};
};

/** Write a `dedup.json` recording what a previous pass ruled on. */
const writeDedup = ({ workspaceDir, reviewed }: { workspaceDir: string; reviewed: DedupReport['reviewed'] }) => {
	writeFileSync(
		join(workspaceDir, 'dedup.json'),
		JSON.stringify({ planName: 'p', findings: [], reviewed, complete: true, reviewedAt: '2026-01-01T00:00:00.000Z' }),
	);
};

test('notePriorArtCollisions: a collision no dedup pass has seen is reported', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	expect(messages.length).toBe(1);
	expect(messages[0]?.includes('1 planned symbol(s) still name-collide')).toBeTruthy();
	expect(messages[0]?.includes('lightsout plan dedup --name p')).toBeTruthy();
});

test('notePriorArtCollisions: a collision dedup already ruled on is not reported again', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	writeDedup({ workspaceDir, reviewed: [{ plannedSymbol: 'getUser', plannedPath: 'src/getUser.ts', phase: 'plan.md' }] });

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	// the collision is still detectable on disk — a `defer` or `distinct` ruling
	// keeps both files — but there is no work left in it, so the nudge is silent
	expect(messages).toStrictEqual([]);
});

test('notePriorArtCollisions: a collision with no recorded ruling is still reported when others have one', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	writeDedup({ workspaceDir, reviewed: [{ plannedSymbol: 'somethingElse', plannedPath: 'src/somethingElse.ts', phase: 'plan.md' }] });

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	// a report that ruled on a different symbol settles nothing here
	expect(messages.length).toBe(1);
	expect(messages[0]?.includes('1 planned symbol(s) still name-collide')).toBeTruthy();
});

test('notePriorArtCollisions: a ruling on the same name at a different path does not settle this one', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	writeDedup({ workspaceDir, reviewed: [{ plannedSymbol: 'getUser', plannedPath: 'src/other/getUser.ts', phase: 'plan.md' }] });

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	// identity is the triple, so the same name planned somewhere else is a
	// separate collision that nobody has weighed
	expect(messages.length).toBe(1);
});

test('notePriorArtCollisions: a dedup.json that no longer parses reports every collision', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	writeFileSync(join(workspaceDir, 'dedup.json'), '{ not json at all');

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	// an unreadable record means nothing is known to be settled — the nudge falls
	// back to its older, noisier self rather than going quiet
	expect(messages.length).toBe(1);
});

test('notePriorArtCollisions: a report written before the reviewed field existed reports every collision', async () => {
	const { cwd, name, workspaceDir, planPaths, messages, onProgress } = setup();

	writeFileSync(join(workspaceDir, 'dedup.json'), JSON.stringify({ planName: 'p', findings: [], complete: true, reviewedAt: '2026-01-01T00:00:00.000Z' }));

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, onProgress });

	expect(messages.length).toBe(1);
});

test('notePriorArtCollisions: a plan with no collisions says nothing', async () => {
	const { cwd, name, workspaceDir } = seedDedupPlan({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const messages: string[] = [];

	await notePriorArtCollisions({
		cwd,
		name,
		workspaceDir,
		planPaths: [join(workspaceDir, 'plan.md')],
		onProgress: (message: string) => messages.push(message),
	});

	expect(messages).toStrictEqual([]);
});
