// Dependencies
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { planDedupCommand } from '#src/cli/plan/index.ts';
import { planningCanonicalCommandFixture as setup } from '#tests/helpers/planningCanonicalCommandFixture.ts';

describe('planDedupCommand', () => {
	test('reports canonical prior-art evidence and its independent review without a separate judge fleet', async () => {
		const fixture = await setup();

		const run = planDedupCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([0]);
		const dedup = JSON.parse(await readFile(join(fixture.root, 'dedup.json'), 'utf8'));
		expect(dedup).toEqual(
			expect.objectContaining({ complete: true, workflow: expect.objectContaining({ format: 'planning-dedup-v1', coverageReceiptIds: expect.any(Array) }) }),
		);
		expect(dedup.workflow.coverageReceiptIds.length).toBeGreaterThan(0);
		expect(fixture.calls).toHaveLength(fixture.callsBefore);
	});

	test('reports an unfinished investigation as incomplete instead of implying an empty passing review', async () => {
		const fixture = await setup({ complete: false });

		const run = planDedupCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		const dedup = JSON.parse(await readFile(join(fixture.root, 'dedup.json'), 'utf8'));
		expect(dedup.complete).toBe(false);
		expect(dedup.incompleteReason).toBeTruthy();
		expect(fixture.calls).toHaveLength(fixture.callsBefore);
	});
	test('shows unresolved canonical findings with their consequences and required remedy', async () => {
		const fixture = await setup({ finding: true });

		const run = planDedupCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		expect(fixture.logged.some((line) => line.includes('existing-retry-helper'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('user must upload completed content again'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('Preserve retry identity'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('no duplication found'))).toBe(false);
	});
});
