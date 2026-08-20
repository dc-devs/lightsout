import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';

test('getFrictionPath: one append-only friction log per consumer repo', () => {
	expect(getFrictionPath({ cwd: '/repo' })).toBe(join('/repo', '.lightsout', 'friction.jsonl'));
});
