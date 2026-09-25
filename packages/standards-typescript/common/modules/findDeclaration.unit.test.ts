import { describe, expect, test } from '@jest/globals';
import type { ModuleLink } from '../types/ModuleLink.ts';
import { findDeclaration } from './findDeclaration.ts';

/** A re-export line, as `readModuleLinks` reads it. */
const reExport = ({ target, names }: { target: string; names: Array<[string, string]> }): ModuleLink => ({
	typeOnly: false,
	reExport: true,
	target,
	resolved: true,
	star: false,
	names: names.map(([from, as]) => ({ from, as })),
});

describe('findDeclaration', () => {
	test('follows a name through every barrel in its chain to the file that declares it', () => {
		const links = new Map([
			['src/runState/index.ts', [reExport({ target: 'src/runState/lock/index.ts', names: [['withRunLock', 'withRunLock']] })]],
			['src/runState/lock/index.ts', [reExport({ target: 'src/runState/lock/withRunLock.ts', names: [['withRunLock', 'withRunLock']] })]],
		]);

		const declaration = findDeclaration({ name: 'withRunLock', target: 'src/runState/lock/index.ts', links });

		expect(declaration).toStrictEqual({ file: 'src/runState/lock/withRunLock.ts', name: 'withRunLock' });
	});

	test('carries a rename made on the way to the name the declaring file exports', () => {
		const links = new Map([['src/app/ingestion/index.ts', [reExport({ target: 'src/app/ingestion/ingestRecords.ts', names: [['ingestRecords', 'ingest']] })]]]);

		const declaration = findDeclaration({ name: 'ingest', target: 'src/app/ingestion/index.ts', links });

		expect(declaration).toStrictEqual({ file: 'src/app/ingestion/ingestRecords.ts', name: 'ingestRecords' });
	});

	test('a target that is no barrel is the declaring file itself', () => {
		const declaration = findDeclaration({ name: 'ingestRecords', target: 'src/ingestion/ingestRecords.ts', links: new Map() });

		expect(declaration).toStrictEqual({ file: 'src/ingestion/ingestRecords.ts', name: 'ingestRecords' });
	});

	test('ends at the barrel it reached when that barrel does not publish the name, or the chain loops back', () => {
		const links = new Map([
			['src/a/index.ts', [reExport({ target: 'src/a/b/index.ts', names: [['loop', 'loop']] })]],
			['src/a/b/index.ts', [reExport({ target: 'src/a/index.ts', names: [['loop', 'loop']] })]],
		]);

		const unpublished = findDeclaration({ name: 'absent', target: 'src/a/index.ts', links });
		const looped = findDeclaration({ name: 'loop', target: 'src/a/index.ts', links });

		expect(unpublished).toStrictEqual({ file: 'src/a/index.ts', name: 'absent' });
		expect(looped).toStrictEqual({ file: 'src/a/index.ts', name: 'loop' });
	});

	test('an entry whose target could not be placed has no declaration', () => {
		expect(findDeclaration({ name: 'ingestRecords', target: undefined, links: new Map() })).toBeUndefined();
	});
});
