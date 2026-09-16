import { mkdir } from 'node:fs/promises';
import { describe, expect, jest, test } from '@jest/globals';
import { restorePlanningSession } from '#src/queue/workers/restorePlanningSession.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const mockPlan = jest.fn<typeof import('#src/ticket/index.ts').restoreTicketPlan>();
const mockBrainstorm = jest.fn<typeof import('#src/brainstorm/index.ts').restoreBrainstormFiles>();
jest.mock('#src/ticket/index.ts', () => ({ restoreTicketPlan: (params: Parameters<typeof mockPlan>[0]) => mockPlan(params) }));
jest.mock('#src/brainstorm/index.ts', () => ({ restoreBrainstormFiles: (params: Parameters<typeof mockBrainstorm>[0]) => mockBrainstorm(params) }));
const setup = async ({
	existing = false,
	canonical = false,
	name = 'lo-144-planning/001-retry',
}: {
	existing?: boolean;
	canonical?: boolean;
	name?: string;
} = {}) => {
	const fixture = await planningWorkflowFixture({ name });
	if (existing) await mkdir(fixture.root, { recursive: true });
	if (canonical) await fixture.capture();
	mockPlan.mockResolvedValue({ restored: [] });
	mockBrainstorm.mockResolvedValue({ restored: [], skipped: [] });
	return {
		...fixture,
		planAddress: name,
		identifier: 'LO-144',
		config: { ...fixture.runtime.config, 'ticket-tracker': { provider: 'linear' as const, team: 'LO', 'api-key-env': 'TEST_KEY' } },
		env: { TEST_KEY: 'injected-test-token' },
	};
};

describe('restorePlanningSession', () => {
	test('keeps existing canonical authority local', async () => {
		const fixture = await setup({ canonical: true });
		await restorePlanningSession(fixture);
		expect(mockPlan).not.toHaveBeenCalled();
		expect(mockBrainstorm).not.toHaveBeenCalled();
	});
	test.each([false, true])('restores the selected ticket generation before canonical input, existing folder: %s', async (existing) => {
		const fixture = await setup({ existing });
		await restorePlanningSession({ ...fixture, expectedMarker: 'selected-marker' });
		expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ expectedMarker: 'selected-marker', requireBrainstorm: true }));
		expect(mockBrainstorm).not.toHaveBeenCalled();
	});
	test('restores just the exact plan brainstorm when local legacy input exists', async () => {
		const fixture = await setup({ existing: true });
		await restorePlanningSession(fixture);
		expect(mockBrainstorm).toHaveBeenCalledWith(expect.objectContaining({ name: fixture.name, identifier: 'LO-144', titlePrefix: '001-retry' }));
		expect(mockPlan).not.toHaveBeenCalled();
	});
	test('surfaces a plan restore refusal', async () => {
		const fixture = await setup();
		mockPlan.mockResolvedValue({ error: 'Missing selected generation' });
		await expect(restorePlanningSession(fixture)).rejects.toThrow('Missing selected generation');
	});
	test('surfaces a brainstorm restore refusal', async () => {
		const fixture = await setup({ existing: true });
		mockBrainstorm.mockResolvedValue({ restored: [], skipped: [], error: 'Conflicting notes' });
		await expect(restorePlanningSession(fixture)).rejects.toThrow('Conflicting notes');
	});
	test('requires tracker credentials before attempting brainstorm restoration', async () => {
		const fixture = await setup({ existing: true });
		await expect(restorePlanningSession({ ...fixture, env: {} })).rejects.toThrow('API key');
		expect(mockBrainstorm).not.toHaveBeenCalled();
	});
	test('refuses ambiguous legacy plan addresses', async () => {
		const fixture = await setup({ existing: true, name: 'unaddressed' });
		await expect(restorePlanningSession(fixture)).rejects.toThrow('exact ticket plan address');
		expect(mockBrainstorm).not.toHaveBeenCalled();
	});
});
