import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';

const setupCatalog = () => {
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { byId };
};

describe('commandCatalog flags', () => {
	test('accepts exactly the flags the usage text carried before the catalog held them', () => {
		const accepted = commandCatalog.map((entry) => [entry.id, [...new Set(entry.flags.map((flag) => flag.name))].sort()]);

		expect(accepted).toStrictEqual([
			['brainstorm', ['cwd', 'name']],
			['plan', ['cwd', 'name', 'no-worktree', 'notes', 'phase', 'scope', 'worktree']],
			['auto-plan', []],
			['implement', ['cwd', 'no-ship', 'no-worktree', 'overview', 'packages', 'plan', 'ship', 'skip-refactor', 'start-phase', 'worktree']],
			['implement-direct', ['cwd', 'no-ship', 'no-worktree', 'ref', 'ship', 'ticket', 'worktree']],
			['resume', ['cwd', 'no-ship', 'run', 'ship', 'skip-refactor']],
			['ship', ['cwd']],
			['queue', ['cwd', 'file-relay']],
			['ticket', ['approve', 'cwd', 'implementation-removed', 'keep', 'name', 'plan', 'plans', 'reason', 'set', 'slug', 'title', 'withdraw']],
			['ticket-state', ['cwd', 'planning-status', 'ref', 'tracker-status']],
			['self-check', ['cwd', 'run']],
			['refactor', ['all', 'allow-dirty', 'code-checks', 'cwd', 'max-batches', 'path', 'run']],
			['test-coverage-to-threshold', ['allow-dirty', 'cwd', 'max-batches', 'run']],
			['standards-check', ['agent-review', 'all', 'baseline', 'code-checks', 'cwd', 'list', 'path']],
			['standards-validate', ['cwd', 'pack']],
			['standards-health', ['cwd']],
			['status', ['cwd', 'planning', 'queue', 'run', 'shipping', 'watch']],
			['doctor', ['cwd']],
			['friction', ['cwd']],
			['improve', ['cwd', 'engine']],
			['voice', ['cwd']],
		]);
	});

	test('repeats a flag name within one entry only across different shapes, so nothing renders twice on one usage line', () => {
		const clashes = commandCatalog.flatMap((entry) =>
			entry.flags.map((flag) => `${entry.id} --${flag.name} in ${flag.shape ?? 'every shape'}`).filter((key, index, keys) => keys.indexOf(key) !== index),
		);

		expect(clashes).toStrictEqual([]);
	});

	test('states implement’s --plan twice, because a file and a folder take different placeholders', () => {
		const { byId } = setupCatalog();
		const planFlags = byId.get('implement')?.flags.filter((flag) => flag.name === 'plan');

		expect(planFlags).toEqual([
			expect.objectContaining({ value: '<path>', shape: 'implement', required: true }),
			expect.objectContaining({ value: '<folder>', shape: 'implement-folder', required: true }),
		]);
	});

	test('both implement commands accept the worktree flags', () => {
		const { byId } = setupCatalog();

		const isolation = ['implement', 'implement-direct'].map((id) => [
			id,
			(byId.get(id)?.flags ?? [])
				.map((flag) => flag.name)
				.filter((name) => name === 'worktree' || name === 'no-worktree')
				.sort(),
		]);

		expect(isolation).toStrictEqual([
			['implement', ['no-worktree', 'worktree']],
			['implement-direct', ['no-worktree', 'worktree']],
		]);
	});

	test('points the worktree flag at its config key and leaves both isolation flags optional on every usage shape', () => {
		const { byId } = setupCatalog();
		const isolationFlags = ['implement', 'implement-direct'].flatMap((id) =>
			(byId.get(id)?.flags ?? []).filter((flag) => flag.name === 'worktree' || flag.name === 'no-worktree').map((flag) => ({ id, ...flag })),
		);

		expect(isolationFlags.filter((flag) => flag.name === 'worktree').map((flag) => flag.fallback)).toEqual([
			expect.stringMatching(/implement\.worktree.*defaults to on/),
			expect.stringMatching(/implement\.worktree.*defaults to on/),
		]);
		expect(isolationFlags.map((flag) => [`${flag.id} --${flag.name}`, flag.value, flag.required, flag.shape])).toStrictEqual([
			['implement --worktree', undefined, false, undefined],
			['implement --no-worktree', undefined, false, undefined],
			['implement-direct --worktree', undefined, false, undefined],
			['implement-direct --no-worktree', undefined, false, undefined],
		]);
	});

	test('plan accepts the worktree flags, with the config key named as the fallback', () => {
		const { byId } = setupCatalog();

		const isolationFlags = (byId.get('plan')?.flags ?? []).filter((flag) => flag.name === 'worktree' || flag.name === 'no-worktree');

		expect(isolationFlags.map((flag) => [flag.name, flag.required, flag.shape])).toStrictEqual([
			['worktree', false, undefined],
			['no-worktree', false, undefined],
		]);
		expect(isolationFlags.find((flag) => flag.name === 'worktree')?.fallback).toEqual(expect.stringMatching(/plan\.worktree/));
	});

	test('scopes each ticket flag to the subcommand that reads it', () => {
		const { byId } = setupCatalog();

		const ticketFlags = byId.get('ticket')?.flags ?? [];

		expect(ticketFlags.map((flag) => [flag.name, flag.shape])).toStrictEqual([
			['name', undefined],
			['slug', 'ticket-add-plan'],
			['title', 'ticket-add-plan'],
			['slug', 'ticket-adopt'],
			['set', 'ticket-mode'],
			['approve', 'ticket-mode'],
			['plans', 'ticket-request-ship'],
			['withdraw', 'ticket-request-ship'],
			['plan', 'ticket-exclude-plan'],
			['reason', 'ticket-exclude-plan'],
			['implementation-removed', 'ticket-exclude-plan'],
			['plan', 'ticket-retitle-plan'],
			['title', 'ticket-retitle-plan'],
			['keep', 'ticket-sync'],
			['cwd', undefined],
		]);
		expect(ticketFlags.filter((flag) => flag.exclusiveWith !== undefined).map((flag) => flag.name)).toStrictEqual(['plans', 'withdraw']);
		expect(new Set(ticketFlags.filter((flag) => flag.exclusiveWith !== undefined).map((flag) => flag.exclusiveWith)).size).toBe(1);
	});

	test('tells the reader what happens without each optional ticket flag, and gives the required ones no fallback', () => {
		const { byId } = setupCatalog();

		const ticketFlags = byId.get('ticket')?.flags ?? [];

		expect(ticketFlags.map((flag) => [`${flag.name} in ${flag.shape ?? 'every shape'}`, flag.required, flag.fallback !== undefined])).toStrictEqual([
			['name in every shape', true, false],
			['slug in ticket-add-plan', true, false],
			['title in ticket-add-plan', false, true],
			['slug in ticket-adopt', true, false],
			['set in ticket-mode', true, false],
			['approve in ticket-mode', false, true],
			['plans in ticket-request-ship', false, true],
			['withdraw in ticket-request-ship', false, true],
			['plan in ticket-exclude-plan', true, false],
			['reason in ticket-exclude-plan', true, false],
			['implementation-removed in ticket-exclude-plan', false, true],
			['plan in ticket-retitle-plan', true, false],
			['title in ticket-retitle-plan', true, false],
			['keep in ticket-sync', false, true],
			['cwd in every shape', false, true],
		]);
	});

	test('a flag that excludes another names a key at least one sibling shares, or its bracket would hold one flag', () => {
		const lonely = commandCatalog.flatMap((entry) =>
			entry.flags
				.filter((flag) => flag.exclusiveWith !== undefined && entry.flags.filter((other) => other.exclusiveWith === flag.exclusiveWith).length < 2)
				.map((flag) => `${entry.id} --${flag.name}`),
		);

		expect(lonely).toStrictEqual([]);
	});
});
