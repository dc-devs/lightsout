import { describe, expect, test } from '@jest/globals';
import { commandCatalog, renderUsage } from '#src/commands/index.ts';

const setupCatalog = () => {
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { byId };
};

describe('commandCatalog flags', () => {
	test('accepts exactly the flags the usage text carried before the catalog held them', () => {
		const accepted = commandCatalog.map((entry) => [entry.id, [...new Set(entry.flags.map((flag) => flag.name))].sort()]);

		expect(accepted).toStrictEqual([
			['brainstorm', ['cwd', 'name']],
			['plan', ['cwd', 'legacy', 'name', 'no-worktree', 'notes', 'phase', 'scope', 'worktree']],
			['auto-plan', []],
			['implement', ['cwd', 'no-ship', 'no-worktree', 'overview', 'packages', 'plan', 'ship', 'skip-refactor', 'start-phase', 'worktree']],
			['implement-direct', ['cwd', 'no-ship', 'no-worktree', 'ref', 'ship', 'ticket', 'worktree']],
			['resume', ['cwd', 'no-ship', 'run', 'ship', 'skip-refactor']],
			['ship', ['cwd']],
			['queue', ['cwd', 'file-relay']],
			['ticket', ['approve', 'cwd', 'from', 'implementation-removed', 'keep', 'name', 'plan', 'plans', 'reason', 'set', 'slug', 'title', 'withdraw']],
			['ticket-state', ['cwd', 'planning-status', 'ref', 'tracker-status']],
			['self-check', ['cwd', 'run']],
			['refactor', ['all', 'allow-dirty', 'code-checks', 'cwd', 'max-batches', 'path', 'run']],
			['test-coverage-to-threshold', ['allow-dirty', 'cwd', 'max-batches', 'run']],
			['standards-check', ['agent-review', 'all', 'baseline', 'code-checks', 'cwd', 'list', 'path']],
			['standards-validate', ['cwd', 'pack']],
			['standards-health', ['cwd']],
			['status', ['cwd', 'planning', 'queue', 'run', 'shipping', 'watch']],
			['report', ['cwd', 'json', 'plan']],
			['doctor', ['cwd', 'usage-probe']],
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

	test('plan accepts the legacy flag on the draft invocation and renders it in the usage text', () => {
		const { byId } = setupCatalog();
		const legacyFlags = (byId.get('plan')?.flags ?? []).filter((flag) => flag.name === 'legacy');

		const draftLine = renderUsage()
			.split('\n')
			.find((line) => line.startsWith('  lightsout plan draft'));

		// the accepted set is read from this row, so the flag works exactly when --help says it does
		expect(legacyFlags.map((flag) => [flag.name, flag.value, flag.shape, flag.required])).toStrictEqual([['legacy', undefined, 'plan-draft', false]]);
		expect(draftLine).toEqual(expect.stringContaining('[--legacy]'));
	});

	test('doctor accepts --usage-probe and renders it on its usage line', () => {
		const { byId } = setupCatalog();
		const doctorFlags = byId.get('doctor')?.flags ?? [];

		const doctorLine = renderUsage()
			.split('\n')
			.find((line) => line.startsWith('  lightsout doctor'));

		// the accepted set is read from these rows, so the flag works exactly when --help says it does
		expect(doctorFlags.map((flag) => [flag.name, flag.value, flag.shape, flag.required, flag.fallback])).toStrictEqual([
			['cwd', '<path>', undefined, false, 'The process working directory.'],
			['usage-probe', undefined, undefined, false, undefined],
		]);
		expect(doctorLine).toEqual(expect.stringContaining('[--usage-probe]'));
	});

	test('the usage-probe row says it spends a real call on the configured harness, and what that call answers', () => {
		const { byId } = setupCatalog();
		const usageProbe = byId.get('doctor')?.flags.find((flag) => flag.name === 'usage-probe');

		// human-facing copy, so the wording is loose — what it has to carry is the one spawn, the question it answers, and the cost
		expect(usageProbe?.meaning).toEqual(expect.stringMatching(/one .*agent call.*harness/i));
		expect(usageProbe?.meaning).toEqual(expect.stringMatching(/token.*parse/i));
		expect(usageProbe?.meaning).toEqual(expect.stringMatching(/money/i));
	});

	test('scopes each ticket flag to the subcommand that reads it', () => {
		const { byId } = setupCatalog();

		const ticketFlags = byId.get('ticket')?.flags ?? [];

		expect(ticketFlags.map((flag) => [flag.name, flag.shape])).toStrictEqual([
			['name', undefined],
			['slug', 'ticket-add-plan'],
			['title', 'ticket-add-plan'],
			['from', 'ticket-add-plan'],
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
			['from in ticket-add-plan', false, true],
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

	test('scopes --from to ticket-add-plan and leaves no flag shaped to a removed invocation', () => {
		const { byId } = setupCatalog();
		const ticketEntry = byId.get('ticket');
		const invocationIds = new Set((ticketEntry?.invocations ?? []).map((invocation) => invocation.id));

		const fromFlags = (ticketEntry?.flags ?? []).filter((flag) => flag.name === 'from');
		const orphanShapes = (ticketEntry?.flags ?? [])
			.filter((flag) => flag.shape !== undefined && !invocationIds.has(flag.shape))
			.map((flag) => `--${flag.name} in ${flag.shape ?? 'every shape'}`);

		expect(fromFlags).toEqual([expect.objectContaining({ value: '<folder>', shape: 'ticket-add-plan', required: false, fallback: expect.any(String) })]);
		expect(orphanShapes).toStrictEqual([]);
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
