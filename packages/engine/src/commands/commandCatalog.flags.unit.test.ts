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
			['plan', ['cwd', 'name', 'notes', 'phase', 'scope']],
			['auto-plan', []],
			['implement', ['cwd', 'no-ship', 'no-worktree', 'overview', 'packages', 'plan', 'ship', 'skip-refactor', 'start-phase', 'worktree']],
			['implement-direct', ['cwd', 'no-ship', 'no-worktree', 'ref', 'ship', 'ticket', 'worktree']],
			['resume', ['cwd', 'no-ship', 'run', 'ship', 'skip-refactor']],
			['ship', ['cwd']],
			['queue', ['cwd', 'file-relay']],
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

	test('a flag that excludes another names a key at least one sibling shares, or its bracket would hold one flag', () => {
		const lonely = commandCatalog.flatMap((entry) =>
			entry.flags
				.filter((flag) => flag.exclusiveWith !== undefined && entry.flags.filter((other) => other.exclusiveWith === flag.exclusiveWith).length < 2)
				.map((flag) => `${entry.id} --${flag.name}`),
		);

		expect(lonely).toStrictEqual([]);
	});
});
