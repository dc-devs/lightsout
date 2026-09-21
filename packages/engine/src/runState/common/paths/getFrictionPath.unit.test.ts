import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

test('getFrictionPath: one append-only friction log per consumer repo', async () => {
	const cwd = await freshCwd();

	expect(await getFrictionPath({ cwd })).toBe(join(cwd, '.lightsout', 'friction.jsonl'));
});
