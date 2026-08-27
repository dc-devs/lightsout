import { describe, expect, test } from '@jest/globals';
import { getCommandCatalogEntry } from '#src/commands/index.ts';

describe('getCommandCatalogEntry', () => {
	test('answers a command word with its own entry', () => {
		const entry = getCommandCatalogEntry({ id: 'standards-validate' });

		expect(entry?.cli).toBe('lightsout standards-validate');
	});

	test('answers the one skill that has no command word, since the page addresses it by the same id', () => {
		const entry = getCommandCatalogEntry({ id: 'brainstorm' });

		expect(entry?.slash).toBe('/brainstorm');
	});

	test('a word no command answers to is undefined rather than an error — the route turns that into a not-found', () => {
		expect(getCommandCatalogEntry({ id: 'nonesuch' })).toBeUndefined();
	});

	test('matches on the id rather than on the slash or CLI form', () => {
		expect(getCommandCatalogEntry({ id: '/refactor' })).toBeUndefined();
		expect(getCommandCatalogEntry({ id: 'lightsout refactor' })).toBeUndefined();
	});
});
