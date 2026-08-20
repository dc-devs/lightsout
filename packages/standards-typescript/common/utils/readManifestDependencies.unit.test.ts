import { describe, expect, test } from '@jest/globals';
import { readManifestDependencies } from './readManifestDependencies.ts';

const setupContents = ({ entries }: { entries: Array<[string, string]> }) => ({ contents: new Map(entries) });

describe('readManifestDependencies', () => {
	test("keys each package's declared names on the folder holding its manifest", () => {
		const { contents } = setupContents({
			entries: [['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-router": "^1.0.0" } }']],
		});

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map([['packages/web-app', ['@tanstack/react-router']]]));
	});

	test('anchors a manifest at the repo root to the root itself', () => {
		const { contents } = setupContents({ entries: [['package.json', '{ "devDependencies": { "jest": "^30.0.0" } }']] });

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map([['.', ['jest']]]));
	});

	test('unions the three dependency fields, since the question is what the package declares', () => {
		const { contents } = setupContents({
			entries: [
				[
					'packages/web-app/package.json',
					'{ "dependencies": { "react": "^19.0.0" }, "devDependencies": { "vite": "^6.0.0" }, "peerDependencies": { "typescript": ">=5" } }',
				],
			],
		});

		expect(readManifestDependencies({ contents })?.get('packages/web-app')).toStrictEqual(['react', 'vite', 'typescript']);
	});

	test('a manifest declaring nothing is still a package, with an empty list', () => {
		const { contents } = setupContents({ entries: [['packages/shared/package.json', '{ "name": "@lightsout/shared" }']] });

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map([['packages/shared', []]]));
	});

	test('leaves out everything that is not a manifest, including a source file whose name ends the same way', () => {
		const { contents } = setupContents({
			entries: [
				['packages/web-app/src/app.ts', 'export const app = 1;\n'],
				['packages/web-app/tsconfig.json', '{}'],
				['packages/web-app/src/writePackage.json', '{}'],
			],
		});

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map());
	});

	test('drops a manifest whose text is not readable JSON rather than failing the run', () => {
		const { contents } = setupContents({ entries: [['packages/web-app/package.json', '{ "dependencies": ']] });

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map());
	});

	test('drops a manifest whose text parses to something that is not an object', () => {
		const { contents } = setupContents({ entries: [['packages/web-app/package.json', '"not a manifest"']] });

		expect(readManifestDependencies({ contents })).toStrictEqual(new Map());
	});
});
