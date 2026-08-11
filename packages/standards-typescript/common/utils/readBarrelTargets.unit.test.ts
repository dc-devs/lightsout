import { describe, expect, test } from '@jest/globals';
import { readBarrelTargets } from './readBarrelTargets.ts';

/** One barrel and the files around it, as a file-text rule hands them over. */
const setupBarrel = ({
	text,
	paths = ['src/feature/index.ts', 'src/feature/renderGreeting.ts', 'src/feature/buildGreeting.ts'],
}: {
	text: string;
	paths?: string[];
}) => ({ barrelPath: 'src/feature/index.ts', text, files: new Set(paths) });

describe('readBarrelTargets', () => {
	test('collects the files a barrel re-exports', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: ["export { renderGreeting } from './renderGreeting';", "export { buildGreeting } from './buildGreeting';"].join('\n'),
		});

		const targets = readBarrelTargets({ barrelPath, text, files });

		expect(targets).toStrictEqual(new Set(['src/feature/renderGreeting.ts', 'src/feature/buildGreeting.ts']));
	});

	test('counts an `export *` line’s file, which carries no names to match on', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export * from './renderGreeting';" });

		const targets = readBarrelTargets({ barrelPath, text, files });

		expect(targets).toStrictEqual(new Set(['src/feature/renderGreeting.ts']));
	});

	test('counts one file once however many lines publish from it', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: ["export { renderGreeting } from './renderGreeting';", "export type { Greeting } from './renderGreeting';"].join('\n'),
		});

		const targets = readBarrelTargets({ barrelPath, text, files });

		expect(targets).toStrictEqual(new Set(['src/feature/renderGreeting.ts']));
	});

	test('contributes nothing for a specifier that resolves outside the files in scope', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: ["export { z } from 'zod';", "export { missing } from './missing';"].join('\n'),
		});

		const targets = readBarrelTargets({ barrelPath, text, files });

		expect(targets).toStrictEqual(new Set());
	});
});
