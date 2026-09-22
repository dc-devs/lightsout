import { describe, expect, test } from '@jest/globals';
import { readCommandFlags } from '#src/cli/common/args/readCommandFlags.ts';
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
			['work-order', ['approve', 'cwd', 'implementation-removed', 'keep', 'name', 'plan', 'plans', 'reason', 'set', 'slug', 'ticket', 'title', 'withdraw']],
			['ticket-state', ['cwd', 'planning-status', 'ref', 'tracker-status']],
			['self-check', ['cwd', 'run']],
			['refactor', ['all', 'allow-dirty', 'code-checks', 'cwd', 'max-batches', 'path', 'run']],
			['test-coverage-to-threshold', ['allow-dirty', 'cwd', 'max-batches', 'run']],
			['standards-check', ['agent-review', 'all', 'baseline', 'code-checks', 'cwd', 'list', 'path']],
			['standards-validate', ['cwd', 'pack']],
			['standards-health', ['cwd']],
			['status', ['cwd', 'now', 'planning', 'queue', 'run', 'shipping', 'wait', 'watch']],
			['report', ['cwd', 'json', 'plan']],
			['doctor', ['cwd', 'usage-probe']],
			['friction', ['cwd']],
			['improve', ['cwd', 'engine']],
			['voice', ['cwd']],
		]);
	});

	test('status accepts --now and --wait, since its accepted set is read from the catalog', () => {
		const statusFlags = readCommandFlags({ command: 'status' });

		expect([...statusFlags].sort()).toStrictEqual(['cwd', 'now', 'planning', 'queue', 'run', 'shipping', 'wait', 'watch']);
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

	test('scopes each work-order flag to the subcommand that reads it', () => {
		const { byId } = setupCatalog();

		const workOrderFlags = byId.get('work-order')?.flags ?? [];

		expect(workOrderFlags.map((flag) => [flag.name, flag.shape])).toStrictEqual([
			['ticket', 'work-order-new'],
			['title', 'work-order-new'],
			['name', 'work-order-add-plan'],
			['slug', 'work-order-add-plan'],
			['title', 'work-order-add-plan'],
			['name', 'work-order-mode'],
			['set', 'work-order-mode'],
			['approve', 'work-order-mode'],
			['name', 'work-order-request-ship'],
			['plans', 'work-order-request-ship'],
			['withdraw', 'work-order-request-ship'],
			['name', 'work-order-exclude-plan'],
			['plan', 'work-order-exclude-plan'],
			['reason', 'work-order-exclude-plan'],
			['implementation-removed', 'work-order-exclude-plan'],
			['name', 'work-order-retitle-plan'],
			['plan', 'work-order-retitle-plan'],
			['title', 'work-order-retitle-plan'],
			['name', 'work-order-show'],
			['name', 'work-order-sync'],
			['keep', 'work-order-sync'],
			['cwd', undefined],
		]);
		expect(workOrderFlags.filter((flag) => flag.exclusiveWith !== undefined).map((flag) => flag.name)).toStrictEqual(['ticket', 'title', 'plans', 'withdraw']);
		expect(new Set(workOrderFlags.filter((flag) => flag.exclusiveWith !== undefined).map((flag) => flag.exclusiveWith)).size).toBe(2);
	});

	test('tells the reader what happens without each optional work-order flag, and gives the required ones no fallback', () => {
		const { byId } = setupCatalog();

		const workOrderFlags = byId.get('work-order')?.flags ?? [];

		expect(workOrderFlags.map((flag) => [`${flag.name} in ${flag.shape ?? 'every shape'}`, flag.required, flag.fallback !== undefined])).toStrictEqual([
			['ticket in work-order-new', false, true],
			['title in work-order-new', false, true],
			['name in work-order-add-plan', true, false],
			['slug in work-order-add-plan', true, false],
			['title in work-order-add-plan', false, true],
			['name in work-order-mode', true, false],
			['set in work-order-mode', true, false],
			['approve in work-order-mode', false, true],
			['name in work-order-request-ship', true, false],
			['plans in work-order-request-ship', false, true],
			['withdraw in work-order-request-ship', false, true],
			['name in work-order-exclude-plan', true, false],
			['plan in work-order-exclude-plan', true, false],
			['reason in work-order-exclude-plan', true, false],
			['implementation-removed in work-order-exclude-plan', false, true],
			['name in work-order-retitle-plan', true, false],
			['plan in work-order-retitle-plan', true, false],
			['title in work-order-retitle-plan', true, false],
			['name in work-order-show', true, false],
			['name in work-order-sync', true, false],
			['keep in work-order-sync', false, true],
			['cwd in every shape', false, true],
		]);
	});

	test('declares no --from flag and leaves none shaped to a removed invocation', () => {
		const { byId } = setupCatalog();
		const workOrderEntry = byId.get('work-order');
		const invocationIds = new Set((workOrderEntry?.invocations ?? []).map((invocation) => invocation.id));

		const fromFlags = (workOrderEntry?.flags ?? []).filter((flag) => flag.name === 'from');
		const orphanShapes = (workOrderEntry?.flags ?? [])
			.filter((flag) => flag.shape !== undefined && !invocationIds.has(flag.shape))
			.map((flag) => `--${flag.name} in ${flag.shape ?? 'every shape'}`);

		expect(fromFlags).toStrictEqual([]);
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

	test('commandCatalog: the work-order entry pairs --ticket with --title on the new shape and shapes --name onto the subcommands that take it', () => {
		const { byId } = setupCatalog();
		const workOrderEntry = byId.get('work-order');
		const workOrderFlags = workOrderEntry?.flags ?? [];

		const newInvocation = workOrderEntry?.invocations[0];
		const newShapeFlags = workOrderFlags.filter((flag) => flag.shape === undefined || flag.shape === 'work-order-new');
		const nameRows = workOrderFlags.filter((flag) => flag.name === 'name');
		const nameKeys = new Set(newShapeFlags.filter((flag) => flag.exclusiveWith !== undefined).map((flag) => flag.exclusiveWith));
		const acceptedFlags = readCommandFlags({ command: 'work-order' });

		// the line that creates a work order comes first, so `new` is the entry's first invocation
		expect(newInvocation).toEqual(expect.objectContaining({ id: 'work-order-new', positional: 'new' }));

		// the `new` line carries the naming pair and --cwd, and none of the flags that act on a record that already exists
		expect(newShapeFlags.map((flag) => [flag.name, flag.value, flag.shape])).toStrictEqual([
			['ticket', '<ref>', 'work-order-new'],
			['title', '<words>', 'work-order-new'],
			['cwd', '<path>', undefined],
		]);

		// one shared exclusivity key renders the pair in a single bracket, and no other flag joins it
		expect(nameKeys.size).toBe(1);
		expect(workOrderFlags.filter((flag) => flag.exclusiveWith !== undefined && nameKeys.has(flag.exclusiveWith)).map((flag) => flag.name)).toStrictEqual([
			'ticket',
			'title',
		]);
		expect(newShapeFlags.find((flag) => flag.name === 'ticket')?.fallback).toEqual(expect.stringMatching(/--title/));
		expect(newShapeFlags.find((flag) => flag.name === 'title')?.fallback).toEqual(expect.stringMatching(/--ticket/));

		// --name is one row per subcommand that takes it, so it never renders on the line that writes the name itself
		expect(nameRows.map((flag) => flag.shape).sort()).toStrictEqual([
			'work-order-add-plan',
			'work-order-exclude-plan',
			'work-order-mode',
			'work-order-request-ship',
			'work-order-retitle-plan',
			'work-order-show',
			'work-order-sync',
		]);

		// those seven rows fold back into one accepted flag, so the only change to what the command accepts is --ticket
		expect([...acceptedFlags].sort()).toStrictEqual([
			'approve',
			'cwd',
			'implementation-removed',
			'keep',
			'name',
			'plan',
			'plans',
			'reason',
			'set',
			'slug',
			'ticket',
			'title',
			'withdraw',
		]);
	});

	test('readCommandFlags: work-order accepts its declared flags and ticket accepts none of them', () => {
		const workOrderFlags = readCommandFlags({ command: 'work-order' });
		const ticketFlags = readCommandFlags({ command: 'ticket' });

		// the accepted set follows the entry's id, so the old command word accepts nothing the entry declares
		expect([...workOrderFlags].sort()).toStrictEqual([
			'approve',
			'cwd',
			'implementation-removed',
			'keep',
			'name',
			'plan',
			'plans',
			'reason',
			'set',
			'slug',
			'ticket',
			'title',
			'withdraw',
		]);
		expect(ticketFlags).toStrictEqual(new Set(['cwd']));
	});
});
