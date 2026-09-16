import { describe, expect, test } from '@jest/globals';
import { planDraftCommand } from '#src/cli/plan/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async ({ autoApprove = true, scope, empty = false }: { autoApprove?: boolean; scope?: string | true; empty?: boolean } = {}) => {
	const fixture = await planningReviewFixture();
	if (!empty) await fixture.capture();
	const output = captureCommandOutput();
	const config = { ...fixture.runtime.config, 'auto-plan': { 'auto-approve-plan': autoApprove, 'propose-before-draft': true } };
	const flags = new Map<string, string | true>();
	if (scope !== undefined) flags.set('scope', scope);
	return { ...fixture, ...output, params: { ...fixture, driver: fixture.runtime.driver, config, standards: undefined, flags } };
};

describe('planDraftCommand', () => {
	test('runs the replacement planner to reviewed completion and prints its typed result', async () => {
		const fixture = await setup();

		const run = planDraftCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([0]);
		expect(JSON.parse(fixture.logged.at(-1) ?? 'null')).toEqual(expect.objectContaining({ status: 'complete', name: fixture.name }));
		const snapshot = await fixture.current();
		expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review')).toBe(true);
	});

	test('preserves an explicit layout choice and pauses for the configured proposal', async () => {
		const fixture = await setup({ autoApprove: false, scope: 'single' });

		const run = planDraftCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([2]);
		expect(JSON.parse(fixture.logged.at(-1) ?? 'null')).toEqual(expect.objectContaining({ status: 'awaiting-user', questionId: 'proposal:before-draft' }));
		const snapshot = await fixture.current();
		expect(snapshot.record.claims.some((claim) => claim.text === '--scope single' && claim.confirmationId?.startsWith('cli-layout:'))).toBe(true);
		expect(snapshot.record.sources.some((source) => source.text === '--scope single')).toBe(true);
	});

	test.each<string | true>(['wrong', true])('refuses invalid explicit scope %s before invoking a provider', async (scope) => {
		const fixture = await setup({ scope });

		const run = planDraftCommand(fixture.params);

		await expect(run).rejects.toThrow('--scope must be single or phased');
		expect(fixture.calls).toEqual([]);
	});
	test('keeps a layout-only empty workspace blocked without provider work', async () => {
		const fixture = await setup({ empty: true, scope: 'single' });

		const run = planDraftCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		expect(JSON.parse(fixture.logged.at(-1) ?? 'null')).toEqual(expect.objectContaining({ status: 'externally-blocked' }));
		expect(fixture.calls).toEqual([]);
	});
});
