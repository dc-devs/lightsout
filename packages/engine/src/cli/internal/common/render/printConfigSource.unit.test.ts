import { expect, jest, test } from '@jest/globals';
import { printConfigSource } from '#src/cli/internal/common/render/printConfigSource.ts';

// The line IS the output, so capturing console.log is the arrangement.
const captureLogged = () => {
	const logged: string[] = [];

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return { logged };
};

test('printConfigSource: a loaded config is named by its absolute path', () => {
	const { logged } = captureLogged();

	printConfigSource({ configPath: '/Users/dev/lightsout-worktrees/lo-158/lightsout.config.json' });

	expect(logged).toStrictEqual(['  config: /Users/dev/lightsout-worktrees/lo-158/lightsout.config.json']);
});

test('printConfigSource: a checkout with no config says so rather than naming a path', () => {
	const { logged } = captureLogged();

	printConfigSource({ configPath: undefined });

	expect(logged).toStrictEqual(['  config: none — this checkout has no lightsout.config.json, so every setting is its default']);
});
