import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

/** Completed real planning proofs in the same Git checkout. */
export const planningPinFixture = async ({
	respond,
	onProgress,
}: {
	respond?: NonNullable<Parameters<typeof planningReviewFixture>[0]>['respond'];
	onProgress?: (message: string) => void;
} = {}) => {
	const fixture = await planningReviewFixture({ respond });
	fixture.runtime.onProgress = onProgress;
	fixture.runtime.config['auto-plan'] = { 'auto-approve-plan': true };
	execFileSync('git', ['init', '-q'], { cwd: fixture.cwd });
	await writeFile(join(fixture.cwd, '.gitignore'), '.lightsout/\n');
	const result = await fixture.run();
	if (result.status !== 'complete') throw new Error(JSON.stringify(result));
	const snapshot = await fixture.current();
	return { ...fixture, snapshot };
};
