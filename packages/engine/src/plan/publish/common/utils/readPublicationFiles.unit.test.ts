import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { createPlanningRuntime } from '#src/plan/index.ts';
import { readPublicationFiles } from '#src/plan/publish/common/utils/readPublicationFiles.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

test('publishes original completed authority despite mutable Markdown changes', async () => {
	const fixture = await planningHandoffFixture();
	await writeFile(join(fixture.cwd, fixture.plan), '# Unapproved edit');
	const result = await readPublicationFiles({ ...fixture, expectedGeneration: fixture.handoff.generation });
	expect(result.error).toBeUndefined();
	expect(result.resolved?.get('plan.md')).toContain('Preserve completed uploads');
	expect(result.resolved?.get('plan.md')).not.toContain('Unapproved edit');
});

test('refuses publication when the caller selected an older generation', async () => {
	const fixture = await planningHandoffFixture();
	const result = await readPublicationFiles({ ...fixture, expectedGeneration: 'a'.repeat(64) });
	expect(result).toStrictEqual({ files: [], error: 'Planning changed before publication; refresh readiness for the current generation' });
});

test('refuses an unfinished canonical plan', async () => {
	const fixture = await planningWorkflowFixture();
	const runtime = await createPlanningRuntime({
		...fixture,
		driver: fixture.runtime.driver,
		config: fixture.runtime.config,
		mode: fixture.runtime.mode,
		stage: fixture.runtime.stage,
	});
	Object.assign(fixture.runtime, runtime);
	await fixture.capture();
	const result = await readPublicationFiles({ ...fixture, config: fixture.runtime.config });
	expect(result.resolved).toBeUndefined();
	expect(result.error).toContain('not ready');
});

test('does not fall back to flat files when an expected generation is missing', async () => {
	const fixture = await planningWorkflowFixture();
	await mkdir(fixture.root, { recursive: true });
	await writeFile(join(fixture.root, 'plan.md'), '# Legacy projection');
	const result = await readPublicationFiles({ ...fixture, config: fixture.runtime.config, expectedGeneration: 'a'.repeat(64) });
	expect(result).toStrictEqual({ files: [], error: 'New-format plan is missing its canonical generation; restore the complete published plan' });
});
