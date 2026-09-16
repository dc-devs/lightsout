// Dependencies
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime } from '#src/plan/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { ensurePlanningInput } from '#src/plan/workflow/input/index.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async ({
	canonical = false,
	stage = PlanningVocabulary.Stage.Implementation,
}: {
	canonical?: boolean;
	stage?: PlanningRuntime['stage'];
} = {}) => {
	const fixture = await planningWorkflowFixture({ stage });
	await mkdir(fixture.root, { recursive: true });
	const notes = 'Preserve every retry obligation. Rejected: restarting completed uploads.\n\nKeep original credential scope.';
	await writeFile(join(fixture.root, 'brainstorm-notes.md'), notes);
	await writeFile(
		join(fixture.root, 'brainstorm-decisions.json'),
		JSON.stringify({
			planName: fixture.name,
			decisions: [{ source: 'Brainstorm', question: 'Restart?', options: 'Keep / restart', choice: 'Keep completed uploads', rationale: 'Preserve work' }],
		}),
	);
	await writeFile(join(fixture.root, 'transcript.json'), 'local conversation must not enter the plan');
	if (canonical) await fixture.capture();
	return { ...fixture, notes };
};

describe('ensurePlanningInput', () => {
	test('imports complete legacy originals and historical choices without inventing modern approval', async () => {
		const fixture = await setup();

		const snapshot = await ensurePlanningInput({ runtime: fixture.runtime });

		expect(snapshot.record.sources.some((source) => source.text === fixture.notes)).toBe(true);
		expect(snapshot.record.legacySettlements).toHaveLength(1);
		expect(snapshot.record.confirmations).toEqual([]);
		expect(snapshot.record.reviewReceipts).toEqual([]);
		expect([...snapshot.artifacts.values()].some((text) => text.includes('local conversation'))).toBe(false);
	});

	test('keeps canonical originals authoritative over stale flat notes', async () => {
		const fixture = await setup({ canonical: true });

		const snapshot = await ensurePlanningInput({ runtime: fixture.runtime });

		expect(snapshot.record.sources).toEqual(fixture.input.sources);
		expect(snapshot.record.sources.some((source) => source.text === fixture.notes)).toBe(false);
	});

	test('adds implementation work while preserving brainstorm claims and provenance', async () => {
		const fixture = await planningAlignedFixture();
		const runtime = await createPlanningRuntime({
			...fixture,
			driver: fixture.runtime.driver,
			config: fixture.runtime.config,
			mode: fixture.runtime.mode,
			stage: PlanningVocabulary.Stage.Implementation,
		});

		const snapshot = await ensurePlanningInput({ runtime });

		expect(snapshot.record.claims).toEqual(fixture.snapshot.record.claims);
		expect(snapshot.record.sources).toEqual(fixture.snapshot.record.sources);
		expect(snapshot.record.confirmations).toEqual(fixture.snapshot.record.confirmations);
		expect(snapshot.record.work.some((work) => work.stage === 'implementation' && work.role === 'draft')).toBe(true);
		expect(snapshot.record.work.some((work) => work.stage === 'brainstorm')).toBe(true);
	});
});

test('imports phased legacy originals and historical findings without losing identical source files', async () => {
	const fixture = await setup();
	const text = '# Original plan context';
	for (const file of ['overview.md', 'phase1-original.md']) await writeFile(join(fixture.root, file), text);
	await writeFile(join(fixture.root, 'grade-memory.json'), JSON.stringify({ planName: fixture.name, findings: [], updatedAt: 'earlier' }));
	const snapshot = await ensurePlanningInput({ runtime: fixture.runtime });
	expect(
		snapshot.record.artifacts.filter((item) => ['overview', 'phase'].includes(item.variant)).map((item) => ({ path: item.path, variant: item.variant })),
	).toStrictEqual([
		{ path: 'overview.md', variant: 'overview' },
		{ path: 'phase1-original.md', variant: 'phase' },
	]);
	expect(snapshot.record.sources.filter((source) => source.text === text).map((source) => source.artifact)).toStrictEqual([
		'overview.md',
		'phase1-original.md',
	]);
	expect(snapshot.artifacts.get('grade-memory.json')).toContain('earlier');
});
