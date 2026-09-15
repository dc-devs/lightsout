import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, test } from '@jest/globals';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ mutation }: { mutation: string }) => {
	const context = await planningStoreFixture();
	directories.push(context.cwd);
	const parameters = {
		cwd: context.cwd,
		name: context.name,
		record: context.record,
		artifacts: context.artifacts,
		expectedRevision: -1,
		parentDigest: null as string | null,
	};
	if (mutation === 'name') parameters.record.planName = 'different';
	if (mutation === 'revision') parameters.record.revision = 1;
	if (mutation === 'parent') parameters.parentDigest = 'a'.repeat(64);
	if (mutation === 'predecessor') {
		parameters.record.revision = 1;
		parameters.expectedRevision = 0;
		parameters.record.parentDigest = 'a'.repeat(64);
		parameters.parentDigest = parameters.record.parentDigest;
	}
	if (mutation === 'graph') parameters.record.sources = [];
	if (mutation === 'extra') parameters.artifacts.set('extra.md', 'Undeclared artifact');
	if (mutation === 'missing') {
		parameters.artifacts.delete('plan.md');
		parameters.artifacts.set('elsewhere.md', context.text);
	}
	if (mutation === 'changed') parameters.artifacts.set('plan.md', 'Wrong bytes');
	return parameters;
};

describe('commitPlanningSnapshot candidates', () => {
	test.each([
		['name', 'Planning candidate has an inconsistent predecessor'],
		['revision', 'Planning candidate has an inconsistent predecessor'],
		['parent', 'Planning candidate has an inconsistent predecessor'],
		['predecessor', 'Planning predecessor is missing'],
		['graph', 'Invalid planning candidate'],
		['extra', 'Planning artifact descriptors must name every staged artifact exactly once'],
		['missing', 'Planning artifact does not match its descriptor'],
		['changed', 'Planning artifact does not match its descriptor'],
	])('rejects an incomplete or incorrectly addressed candidate: %s', async (mutation, message) => {
		const parameters = await setup({ mutation });

		await expect(commitPlanningSnapshot(parameters)).rejects.toThrow(message);

		expect(await readPlanningSnapshot({ cwd: parameters.cwd, name: parameters.name })).toBeUndefined();
	});
});
