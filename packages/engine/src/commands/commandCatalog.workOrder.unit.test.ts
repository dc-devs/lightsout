import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';

/** Every word `lightsout work-order` answers to, paired with its invocation id, in the order the usage prints them. */
const workOrderInvocationShapes = [
	['work-order-new', 'new'],
	['work-order-add-plan', 'add-plan'],
	['work-order-mode', 'mode'],
	['work-order-request-ship', 'request-ship'],
	['work-order-exclude-plan', 'exclude-plan'],
	['work-order-retitle-plan', 'retitle-plan'],
	['work-order-show', 'show'],
	['work-order-sync', 'sync'],
];

const setupCatalog = () => {
	const ids = commandCatalog.map((entry) => entry.id);
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { ids, byId };
};

describe('commandCatalog work-order', () => {
	test('carries the work-order command in the build group with one invocation per subcommand', () => {
		const { ids, byId } = setupCatalog();
		const workOrder = byId.get('work-order');
		const neighbours = ['brainstorm', 'plan', 'auto-plan', 'implement', 'implement-direct', 'resume', 'ship', 'queue', 'ticket-state', 'self-check'];

		const shapes = workOrder?.invocations.map((invocation) => [invocation.id, invocation.positional]);
		const silentBack = neighbours.filter((id) => byId.get(id)?.related.includes('work-order') !== true);

		expect(workOrder).toEqual(expect.objectContaining({ id: 'work-order', cli: 'lightsout work-order', group: 'build', records: 'plans' }));
		expect(ids[ids.indexOf('work-order') + 1]).toBe('ticket-state');
		expect(shapes).toStrictEqual(workOrderInvocationShapes);
		expect([...(workOrder?.related ?? [])].sort()).toStrictEqual([...neighbours].sort());
		expect(silentBack).toStrictEqual([]);
	});

	test('drops the adopt invocation and leaves eight work-order subcommand shapes', () => {
		const { byId } = setupCatalog();

		const shapes = byId.get('work-order')?.invocations.map((invocation) => [invocation.id, invocation.positional]);

		expect(shapes).toStrictEqual(workOrderInvocationShapes);
	});
});
