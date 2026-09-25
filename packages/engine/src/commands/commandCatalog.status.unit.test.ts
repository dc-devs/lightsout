import { describe, expect, test } from '@jest/globals';
import { readCommandFlags } from '#src/cli/common/args/readCommandFlags.ts';
import { commandCatalog } from '#src/commands/commandCatalog.ts';

const setupCatalog = () => {
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { byId };
};

describe('commandCatalog status entry', () => {
	test('tells the reader what a bare --watch follows, now that it no longer takes the most recently updated run', () => {
		const { byId } = setupCatalog();
		const watch = byId.get('status')?.flags.find((flag) => flag.name === 'watch');

		expect(watch?.meaning).toEqual(expect.stringMatching(/[Ww]ithout --run it follows the one run that is going/));
		expect(watch?.meaning).toEqual(expect.stringMatching(/several .*runs are going.*--run <id>/));
		expect(watch?.meaning).not.toEqual(expect.stringMatching(/newest/i));
	});

	test('states the same rule on the status-run invocation note, which is the line the usage text prints', () => {
		const { byId } = setupCatalog();
		const note = byId.get('status')?.invocations.find((invocation) => invocation.id === 'status-run')?.note;

		expect(note).toEqual(expect.stringMatching(/without --run it follows the one run that is going/));
		expect(note).not.toEqual(expect.stringMatching(/newest/i));
	});

	test('gives status --planning its own invocation, with a required <name> flag shaped to it', () => {
		const { byId } = setupCatalog();
		const invocationIds = byId.get('status')?.invocations.map((invocation) => invocation.id) ?? [];
		const planning = byId.get('status')?.flags.find((flag) => flag.name === 'planning');

		const accepted = readCommandFlags({ command: 'status' });

		expect(invocationIds[invocationIds.indexOf('status-now') + 1]).toBe('status-planning');
		expect(planning).toEqual(expect.objectContaining({ name: 'planning', value: '<name>', shape: 'status-planning', required: true }));
		expect(accepted.has('planning')).toBe(true);
	});

	test('gives status a shipping shape whose --shipping flag is required and belongs to that shape alone', () => {
		const { byId } = setupCatalog();
		const status = byId.get('status');

		const invocationIds = status?.invocations.map((invocation) => invocation.id) ?? [];
		const shippingInvocation = status?.invocations.find((invocation) => invocation.id === 'status-shipping');
		const shipping = status?.flags.find((flag) => flag.name === 'shipping');
		const shapedToShipping = status?.flags.filter((flag) => flag.shape === 'status-shipping').map((flag) => flag.name);

		expect(invocationIds).toEqual(expect.arrayContaining(['status', 'status-run', 'status-shipping']));
		expect(shippingInvocation?.note?.trim()).toEqual(expect.stringMatching(/\S/));
		expect(shipping).toEqual(expect.objectContaining({ name: 'shipping', value: '<branch>', shape: 'status-shipping', required: true }));
		expect(shapedToShipping).toStrictEqual(['shipping']);
	});

	test('status offers --queue as its own invocation, with --run beside it and --watch kept off it', () => {
		const { byId } = setupCatalog();
		const status = byId.get('status');

		const invocationIds = status?.invocations.map((invocation) => invocation.id) ?? [];
		const shapedToQueue = status?.flags.filter((flag) => flag.shape === 'status-queue').map((flag) => [flag.name, flag.value, flag.required]);
		const watch = status?.flags.find((flag) => flag.name === 'watch');

		expect(invocationIds).toEqual(expect.arrayContaining(['status-queue']));
		expect(shapedToQueue).toStrictEqual([
			['queue', undefined, true],
			['run', '<id>', false],
			['wait', undefined, false],
		]);
		expect(watch?.shape).toBe('status-run');
	});

	test('tells the reader a bare --queue takes the live queue run the run lock names, and gives the required --queue no fallback', () => {
		const { byId } = setupCatalog();
		const shapedToQueue = byId.get('status')?.flags.filter((flag) => flag.shape === 'status-queue') ?? [];

		const fallbacks = shapedToQueue.map((flag) => [flag.name, flag.fallback]);

		expect(fallbacks).toEqual([
			['queue', undefined],
			['run', expect.stringMatching(/live queue run.*run lock/)],
			['wait', expect.stringMatching(/at once/)],
		]);
	});

	test('gives status a now shape whose --now flag is required, valueless, and belongs to that shape alone', () => {
		const { byId } = setupCatalog();
		const status = byId.get('status');

		const invocationIds = status?.invocations.map((invocation) => invocation.id) ?? [];
		const nowInvocation = status?.invocations.find((invocation) => invocation.id === 'status-now');
		const now = status?.flags.find((flag) => flag.name === 'now');
		const shapedToNow = status?.flags.filter((flag) => flag.shape === 'status-now').map((flag) => flag.name);

		expect(invocationIds[invocationIds.indexOf('status-run') + 1]).toBe('status-now');
		expect(nowInvocation?.note?.trim()).toEqual(expect.stringMatching(/\S/));
		expect(now).toEqual(expect.objectContaining({ name: 'now', shape: 'status-now', required: true }));
		expect(now?.value).toBeUndefined();
		expect(shapedToNow).toStrictEqual(['now']);
	});

	test('adds --wait to the queue shape and stops the queue run fallback claiming a wait', () => {
		const { byId } = setupCatalog();
		const shapedToQueue = byId.get('status')?.flags.filter((flag) => flag.shape === 'status-queue') ?? [];

		const rows = shapedToQueue.map((flag) => [flag.name, flag.value ?? null, flag.required]);
		const runFallback = shapedToQueue.find((flag) => flag.name === 'run')?.fallback;
		const wait = shapedToQueue.find((flag) => flag.name === 'wait');

		expect(rows).toStrictEqual([
			['queue', null, true],
			['run', '<id>', false],
			['wait', null, false],
		]);
		expect(runFallback).toEqual(expect.stringMatching(/live queue run/));
		expect(runFallback).not.toEqual(expect.stringMatching(/wait|minute/i));
		expect(wait?.meaning).toEqual(expect.stringMatching(/minute/));
		expect(wait?.fallback).toEqual(expect.stringMatching(/at once/));
	});
});
