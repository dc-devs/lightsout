import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { printPlanTicketWarning } from '#src/cli/common/render/printPlanTicketWarning.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { queueConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/**
 * A repo whose config is whatever the case is about, and a `write` standing in
 * for stdout. An object is merged beside the gate block every repo carries; a
 * string is written verbatim, which is how an unparseable config gets planted;
 * `config: undefined` writes no config file at all.
 */
const setupRepo = async ({ config }: { config?: Record<string, unknown> | string } = {}) => {
	const cwd = typeof config === 'object' ? await seedConfiguredCwd({ config }) : await freshCwd();
	const lines: string[] = [];

	process.stdout.isTTY = false;

	if (typeof config === 'string') {
		await writeFile(join(cwd, 'lightsout.config.json'), config, 'utf8');
	}

	return { cwd, lines, write: (line: string) => lines.push(line) };
};

/** A repo whose ticket ids are spelled nothing like the engine default's. */
const configuredPatternRepo = { queue: queueConfigBlock, ship: { 'ticket-pattern': '^(?<ticket>ENG-(?<number>\\d+))' } };

test('printPlanTicketWarning: a folder carrying no ticket id draws one line naming the folder and the key that decides the shape', async () => {
	const { cwd, lines, write } = await setupRepo({ config: { queue: queueConfigBlock } });

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner', write });

	expect(lines).toStrictEqual([
		"⚠ plan folder 'rate-limit-banner' carries no ticket id — name a plan folder after its ticket's branch, matching this repo's ship.ticket-pattern. Continuing from the folder path.",
	]);
});

test('printPlanTicketWarning: a folder named after its ticket says nothing', async () => {
	const { cwd, lines, write } = await setupRepo({ config: { queue: queueConfigBlock } });

	await printPlanTicketWarning({ cwd, name: 'lo-52-status-progress', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: a repo with no tracker configured is unaffected — any plan name keeps working, and nothing is warned about', async () => {
	// a config with the gate block and no queue block: this repo chose no ticket convention
	const { cwd, lines, write } = await setupRepo({ config: {} });

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: a repo with no config at all is silent too', async () => {
	const { cwd, lines, write } = await setupRepo();

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: a config the engine cannot parse is not this advisory’s problem — the commands that need it refuse by name', async () => {
	const { cwd, lines, write } = await setupRepo({ config: '{ not json' });

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: an unusable ship.ticket-pattern blames nothing here, because the folder is not what is wrong', async () => {
	const { cwd, lines, write } = await setupRepo({ config: { queue: queueConfigBlock, ship: { 'ticket-pattern': '^(?<ticket>[a-z' } } });

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: a folder named for the repo’s own configured pattern says nothing, though the engine default would not match it', async () => {
	const { cwd, lines, write } = await setupRepo({ config: configuredPatternRepo });

	await printPlanTicketWarning({ cwd, name: 'ENG-7-rate-limit-banner', write });

	expect(lines).toStrictEqual([]);
});

test('printPlanTicketWarning: the engine default spelling is not a second convention a repo with its own pattern also accepts', async () => {
	const { cwd, lines, write } = await setupRepo({ config: configuredPatternRepo });

	await printPlanTicketWarning({ cwd, name: 'lo-52-status-progress', write });

	expect(lines.length).toBe(1);
});

test('printPlanTicketWarning: with no write given the line goes to stdout, in yellow on a TTY', async () => {
	const { cwd } = await setupRepo({ config: { queue: queueConfigBlock } });
	const logged: string[] = [];

	process.stdout.isTTY = true;
	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	await printPlanTicketWarning({ cwd, name: 'rate-limit-banner' });

	expect(logged).toStrictEqual([
		"\u001b[33m⚠\u001b[0m plan folder 'rate-limit-banner' carries no ticket id — name a plan folder after its ticket's branch, matching this repo's ship.ticket-pattern. Continuing from the folder path.",
	]);
});
