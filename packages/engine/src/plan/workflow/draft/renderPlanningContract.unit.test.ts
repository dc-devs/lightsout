import { describe, expect, test } from '@jest/globals';
import { renderPlanningContract } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

const setup = async ({ defect }: { defect: string }) => {
	const fixture = await planningDraftFixture({ exactStandards: true });
	const snapshot = structuredClone(fixture.snapshot);
	const artifacts = new Map(snapshot.artifacts);
	const original = snapshot.record.claims[0];
	if (defect === 'missing-original') artifacts.delete(`planning-originals/${original.origin.sha256}.txt`);
	if (defect === 'changed-original') artifacts.set(`planning-originals/${original.origin.sha256}.txt`, 'A shorter summary is not the original.');
	if (defect === 'unclassified-source') snapshot.record.sources.push({ ...original.origin, locator: 'a second design input' });
	if (defect === 'missing-view') artifacts.delete('phase1-original.md');
	if (defect === 'changed-view') artifacts.set('phase1-original.md', 'silently changed');
	if (defect === 'missing-claim') snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'A')?.claimIds.push('missing-claim');
	if (defect === 'missing-standard') snapshot.record.standards.pop();
	return { ...fixture, snapshot: { ...snapshot, artifacts }, phaseId: defect === 'missing-phase' ? 'absent' : 'A' };
};

describe('renderPlanningContract', () => {
	test.each([
		'missing-original',
		'changed-original',
		'unclassified-source',
		'missing-view',
		'changed-view',
		'missing-claim',
		'missing-standard',
		'missing-phase',
	])('fails closed for %s instead of replacing missing authority with a summary', async (defect) => {
		const fixture = await setup({ defect });

		const render = () => renderPlanningContract({ snapshot: fixture.snapshot, phaseId: fixture.phaseId });

		expect(render).toThrow(/Missing|changed|classification|Standards descriptors/i);
		expect(fixture.calls).toHaveLength(0);
	});

	test('returns whole-plan exact source and standards authority without claiming implementation predecessor receipts', async () => {
		const fixture = await planningDraftFixture({ exactStandards: true });

		const contract = renderPlanningContract({ snapshot: fixture.snapshot });

		expect(contract.claims.map(({ id }) => id)).toEqual(expect.arrayContaining(['required', 'shared-api', 'retry-choice', 'test-retry']));
		expect(contract.artifacts.map(({ path }) => path)).toEqual(['overview.md', 'phase1-original.md', 'phase3-report.md']);
		expect(contract.predecessorReceiptIds).toEqual([]);
		expect(contract.standards.map(({ text }) => text)).toEqual(fixture.channels.map(({ text }) => text));
		expect(contract.claims.find(({ id }) => id === 'required')?.origin.text).toBe(fixture.origin.text);
	});
});

test('renderPlanningContract rejects an origin that is absent from captured source authority even when its bytes exist', async () => {
	const fixture = await planningDraftFixture();
	const snapshot = structuredClone(fixture.snapshot);
	const claim = snapshot.record.claims.find(({ id }) => id === 'shared-api');
	if (!claim) throw new Error('Expected shared contract');
	claim.origin = { ...claim.origin, locator: 'An uncaptured source location' };

	const render = () => renderPlanningContract({ snapshot, phaseId: 'A' });

	expect(render).toThrow('Missing or changed original source for planning claim shared-api');
	expect(fixture.calls).toHaveLength(0);
});
