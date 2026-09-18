import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolveReportTargets } from '#src/cli/common/activityReport/resolveReportTargets.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/**
 * A temp repo whose plans directory holds a ticket folder of three plans —
 * seeded out of order, so plan-id order is proved rather than inherited from
 * the filesystem — and one legacy folder holding a plan file and no subfolder.
 */
const setupPlansDir = async () => {
	const cwd = await freshCwd();
	const plans = join(cwd, '.lightsout', 'plans');

	for (const planId of ['003-ship-it', '001-search-basics', '002-queue-order']) {
		await mkdir(join(plans, 'lo-150-observability', planId), { recursive: true });
	}

	await mkdir(join(plans, 'legacy-plan'), { recursive: true });
	await writeFile(join(plans, 'legacy-plan', 'plan.md'), '# Plan\n', 'utf8');

	return { cwd, plans };
};

test('resolveReportTargets: an address resolves to one plan, and a ticket folder to every plan under it in order', async () => {
	const { cwd } = await setupPlansDir();

	const address = await resolveReportTargets({ cwd, name: 'lo-150-observability/002-queue-order' });
	const ticketFolder = await resolveReportTargets({ cwd, name: 'lo-150-observability' });

	expect(address).toStrictEqual({ names: ['lo-150-observability/002-queue-order'], ticketFolder: false });
	expect(ticketFolder).toStrictEqual({
		names: ['lo-150-observability/001-search-basics', 'lo-150-observability/002-queue-order', 'lo-150-observability/003-ship-it'],
		ticketFolder: true,
	});
});

test('resolveReportTargets: a legacy folder resolves to its own name with the ticket flag false', async () => {
	const { cwd } = await setupPlansDir();

	const resolved = await resolveReportTargets({ cwd, name: 'legacy-plan' });

	expect(resolved).toStrictEqual({ names: ['legacy-plan'], ticketFolder: false });
});

test('resolveReportTargets: an unknown name answers an error naming the value and the plans directory', async () => {
	const { cwd, plans } = await setupPlansDir();

	const resolved = await resolveReportTargets({ cwd, name: 'no-such-plan' });

	// the name that was asked for and the directory that answered, spelled out
	// rather than matched loosely, so a message that grew a second field fails here
	expect(resolved).toStrictEqual({ error: `no plan folder named 'no-such-plan' under ${plans}` });
});
