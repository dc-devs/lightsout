import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { preparePlanningHandoff } from '#src/plan/index.ts';
import { planningPhasedResponse } from '#tests/helpers/planningPhasedResponse.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

/** Real completed planning and immutable storage; semantic role responses are injected. */
export const planningHandoffFixture = async ({ phased = false }: { phased?: boolean } = {}) => {
	const fixture = await planningReviewFixture({ respond: phased ? planningPhasedResponse : undefined });
	fixture.runtime.config['auto-plan'] = { 'auto-approve-plan': true };
	fixture.runtime.config['standards-packs'] = ['house'];
	for (const [path, text] of Object.entries({
		'house/lightsout-standards.json': '{"name":"house","formatVersion":1}',
		'house/code/base/document.md': '# Code standards\nPreserve completed uploads.',
		'house/tests/base/document.md': '# Test standards\nProve retry retention at the public boundary.',
	})) {
		await mkdir(join(fixture.cwd, path, '..'), { recursive: true });
		await writeFile(join(fixture.cwd, path), text);
	}
	await mkdir(join(fixture.cwd, 'src'), { recursive: true });
	const completed = await fixture.run();
	if (completed.status !== 'complete') throw new Error(JSON.stringify(completed));
	const plan = join('.lightsout/plans', fixture.name, phased ? 'overview.md' : 'plan.md');
	const handoff = await preparePlanningHandoff({ cwd: fixture.cwd, config: fixture.runtime.config, plan });
	if (!handoff) throw new Error('Fixture did not create a canonical handoff');
	return { ...fixture, plan, handoff, config: fixture.runtime.config };
};
