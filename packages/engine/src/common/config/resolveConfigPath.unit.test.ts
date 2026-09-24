import { resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolveConfigPath } from '#src/common/config/resolveConfigPath.ts';

test('resolveConfigPath: the config sits at the root of the checkout the command was launched in', () => {
	expect(resolveConfigPath({ cwd: '/repo' })).toBe('/repo/lightsout.config.json');
});

test('resolveConfigPath: a relative --cwd still yields an absolute path, so two checkouts never print the same one', () => {
	expect(resolveConfigPath({ cwd: 'checkouts/lo-158' })).toBe(resolve('checkouts/lo-158', 'lightsout.config.json'));
});
