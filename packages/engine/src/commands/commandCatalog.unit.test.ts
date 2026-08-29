import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';
import { CommandCatalogEntry } from '#src/contracts/index.ts';

const setupCatalog = () => {
	const ids = commandCatalog.map((entry) => entry.id);
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { ids, byId };
};

describe('commandCatalog', () => {
	test('every entry satisfies its own contract', () => {
		const { ids } = setupCatalog();
		const rejected = commandCatalog.filter((entry) => !CommandCatalogEntry.safeParse(entry).success).map((entry) => entry.id);

		expect(rejected).toStrictEqual([]);
		expect(ids).toHaveLength(18);
	});

	test('ids are unique — two entries answering to one word would make the route ambiguous', () => {
		const { ids } = setupCatalog();

		expect([...new Set(ids)]).toStrictEqual(ids);
	});

	test('covers every command the dispatcher offers, plus the two skills that have no command', () => {
		const { ids } = setupCatalog();

		expect([...ids].sort()).toStrictEqual(
			[
				'auto-plan',
				'brainstorm',
				'doctor',
				'friction',
				'implement',
				'implement-direct',
				'improve',
				'plan',
				'queue',
				'refactor',
				'resume',
				'ship',
				'standards-check',
				'standards-health',
				'standards-validate',
				'status',
				'test-coverage-to-threshold',
				'voice',
			].sort(),
		);
	});

	test('related names only ids the catalog carries, and never the entry itself', () => {
		const { byId } = setupCatalog();
		const stray = commandCatalog.flatMap((entry) => entry.related.filter((id) => !byId.has(id) || id === entry.id));

		expect(stray).toStrictEqual([]);
	});

	test('related is symmetric — a page that lists a neighbour is listed back by it', () => {
		const { byId } = setupCatalog();
		const pairs = commandCatalog.flatMap((entry) => entry.related.map((id) => ({ from: entry.id, to: id })));
		const oneWay = pairs.filter((pair) => byId.get(pair.to)?.related.includes(pair.from) !== true);

		expect(oneWay).toStrictEqual([]);
	});

	test('every invocation id is unique across the catalog, since the usage order addresses them by id alone', () => {
		const invocationIds = commandCatalog.flatMap((entry) => entry.invocations.map((invocation) => invocation.id));

		expect([...new Set(invocationIds)]).toStrictEqual(invocationIds);
	});

	test('every flag shape names an invocation of its own entry — a shape nothing matches would never reach a usage line', () => {
		const orphans = commandCatalog.flatMap((entry) =>
			entry.flags.filter((flag) => flag.shape !== undefined && !entry.invocations.some((invocation) => invocation.id === flag.shape)),
		);

		expect(orphans).toStrictEqual([]);
	});

	test('a command with a CLI form has at least one invocation, and the skill-only commands have none', () => {
		const { byId } = setupCatalog();
		const shapeless = commandCatalog.filter((entry) => entry.cli !== undefined && entry.invocations.length === 0);

		expect(shapeless).toStrictEqual([]);
		expect(byId.get('brainstorm')?.invocations).toStrictEqual([]);
		expect(byId.get('auto-plan')?.invocations).toStrictEqual([]);
	});

	test('leaves exactly the skill-only commands without a CLI word, so nothing types `lightsout auto-plan` at a route that is not there', () => {
		const skillOnly = commandCatalog.filter((entry) => entry.cli === undefined).map((entry) => entry.id);

		expect(skillOnly).toStrictEqual(['brainstorm', 'auto-plan']);
	});

	test('only the three commands with an infographic carry steps, and each carries a graphic to draw them in', () => {
		const drawn = commandCatalog.filter((entry) => entry.steps.length > 0);

		expect(drawn.map((entry) => [entry.id, entry.steps.length])).toStrictEqual([
			['plan', 8],
			['implement', 10],
			['refactor', 12],
		]);
		expect(drawn.every((entry) => entry.graphic !== undefined)).toBe(true);
	});

	test('runs in group order, so the commands page reads its sections straight off the array', () => {
		const sectioned = commandCatalog.map((entry) => [entry.group, entry.id]);

		expect(sectioned).toStrictEqual([
			['build', 'brainstorm'],
			['build', 'plan'],
			['build', 'auto-plan'],
			['build', 'implement'],
			['build', 'implement-direct'],
			['build', 'resume'],
			['build', 'ship'],
			['build', 'queue'],
			['burn-down', 'refactor'],
			['burn-down', 'test-coverage-to-threshold'],
			['standards', 'standards-check'],
			['standards', 'standards-validate'],
			['standards', 'standards-health'],
			['housekeeping', 'status'],
			['housekeeping', 'doctor'],
			['housekeeping', 'friction'],
			['housekeeping', 'improve'],
			['housekeeping', 'voice'],
		]);
	});

	test('related names every other member of the entry’s group — a pair missing from both sides would still look symmetric', () => {
		const missing = commandCatalog.flatMap((entry) =>
			commandCatalog
				.filter((other) => other.group === entry.group && other.id !== entry.id && !entry.related.includes(other.id))
				.map((other) => `${entry.id} → ${other.id}`),
		);

		expect(missing).toStrictEqual([]);
	});

	test('names the kind of record each command leaves behind, which is the shape of its history section', () => {
		const kinds = commandCatalog.map((entry) => [entry.id, entry.records]);

		expect(kinds).toStrictEqual([
			['brainstorm', 'plans'],
			['plan', 'plans'],
			['auto-plan', 'plans'],
			['implement', 'runs'],
			['implement-direct', 'runs'],
			['resume', 'runs'],
			['ship', 'nothing'],
			['queue', 'runs'],
			['refactor', 'runs'],
			['test-coverage-to-threshold', 'runs'],
			['standards-check', 'snapshots'],
			['standards-validate', 'nothing'],
			['standards-health', 'nothing'],
			['status', 'nothing'],
			['doctor', 'nothing'],
			['friction', 'nothing'],
			['improve', 'nothing'],
			['voice', 'nothing'],
		]);
	});

	test('carries a slash form for exactly the commands the plugin ships a skill for', () => {
		const slashed = commandCatalog.filter((entry) => entry.slash !== undefined).map((entry) => [entry.id, entry.slash]);

		expect(slashed).toStrictEqual([
			['brainstorm', '/brainstorm'],
			['plan', '/plan'],
			['auto-plan', '/auto-plan'],
			['implement', '/implement'],
			['refactor', '/refactor'],
			['test-coverage-to-threshold', '/test-coverage-to-threshold'],
			['voice', '/lightsout:voice'],
		]);
	});

	test('accepts exactly the flags the usage text carried before the catalog held them', () => {
		const accepted = commandCatalog.map((entry) => [entry.id, [...new Set(entry.flags.map((flag) => flag.name))].sort()]);

		expect(accepted).toStrictEqual([
			['brainstorm', []],
			['plan', ['cwd', 'name', 'notes', 'phase', 'scope']],
			['auto-plan', []],
			['implement', ['cwd', 'overview', 'packages', 'plan', 'ship', 'skip-refactor', 'start-phase']],
			['implement-direct', ['cwd', 'ref', 'ship', 'ticket']],
			['resume', ['cwd', 'run', 'skip-refactor']],
			['ship', ['cwd']],
			['queue', ['cwd', 'file-relay']],
			['refactor', ['all', 'allow-dirty', 'code-checks', 'cwd', 'max-batches', 'path', 'run']],
			['test-coverage-to-threshold', ['allow-dirty', 'cwd', 'max-batches', 'run']],
			['standards-check', ['agent-review', 'all', 'baseline', 'code-checks', 'cwd', 'list', 'path']],
			['standards-validate', ['cwd', 'pack']],
			['standards-health', ['cwd']],
			['status', ['cwd']],
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

	test('a flag that excludes another names a key at least one sibling shares, or its bracket would hold one flag', () => {
		const lonely = commandCatalog.flatMap((entry) =>
			entry.flags
				.filter((flag) => flag.exclusiveWith !== undefined && entry.flags.filter((other) => other.exclusiveWith === flag.exclusiveWith).length < 2)
				.map((flag) => `${entry.id} --${flag.name}`),
		);

		expect(lonely).toStrictEqual([]);
	});

	test('every step names one of the three actors, a title in caps, and two to four bullets', () => {
		const malformed = commandCatalog.flatMap((entry) =>
			entry.steps
				.filter(
					(step) =>
						!['the engine', 'the agent', 'you decide'].includes(step.actor) ||
						step.title !== step.title.toUpperCase() ||
						step.bullets.length < 2 ||
						step.bullets.length > 4,
				)
				.map((step) => `${entry.id}: ${step.title}`),
		);

		expect(malformed).toStrictEqual([]);
	});

	test('overrides the graphic-wide artifact label only where a step reads a file or writes one conditionally', () => {
		const overrides = commandCatalog.flatMap((entry) =>
			entry.steps.filter((step) => step.savedLabel !== undefined).map((step) => [step.title, step.savedLabel]),
		);

		expect(overrides).toStrictEqual([
			['CREATE THE PLAN WORKSPACE', 'SAVED WHEN NOTES EXIST'],
			['FIND THE WORK', 'READ FROM DISK'],
		]);
	});

	test('each drawn command’s steps run from the step that opens its infographic to the step that closes it', () => {
		const { byId } = setupCatalog();
		const ends = ['plan', 'implement', 'refactor'].map((id) => {
			const steps = byId.get(id)?.steps ?? [];

			return [id, steps.at(0)?.title, steps.at(-1)?.title];
		});

		expect(ends).toStrictEqual([
			['plan', 'CREATE THE PLAN WORKSPACE', 'GET THE PLAN TO AN A GRADE'],
			['implement', 'START THE RUN', 'REPORT THE RESULT'],
			['refactor', 'START THE RUN', 'REVIEW AND COMMIT'],
		]);
	});

	test('every entry says what it does and when to reach for it — both are the command page’s body copy', () => {
		const silent = commandCatalog.filter((entry) => entry.summary.trim() === '' || entry.whenToUse.trim() === '').map((entry) => entry.id);

		expect(silent).toStrictEqual([]);
	});

	test('every flag states what it means, which is the middle column of the manual’s flag table', () => {
		const mute = commandCatalog.flatMap((entry) => entry.flags.filter((flag) => flag.meaning.trim() === '').map((flag) => `${entry.id} --${flag.name}`));

		expect(mute).toStrictEqual([]);
	});

	test('a flag that takes a value names its placeholder, so the usage line never prints a bare --flag that needs one', () => {
		const { byId } = setupCatalog();
		const valued = byId.get('test-coverage-to-threshold')?.flags.map((flag) => [flag.name, flag.value]);

		expect(valued).toStrictEqual([
			['run', '<id>'],
			['cwd', '<path>'],
			['max-batches', '<n>'],
			['allow-dirty', undefined],
		]);
	});
});
