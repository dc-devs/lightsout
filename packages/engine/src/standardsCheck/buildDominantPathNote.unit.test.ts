import { describe, expect, test } from '@jest/globals';
import type { StandardsFinding } from '#src/contracts/index.ts';
import { buildDominantPathNote } from '#src/standardsCheck/buildDominantPathNote.ts';

/** One advisory finding per path — the only field the diagnosis reads is the first file's path. */
const setupFindings = ({ paths }: { paths: string[] }): StandardsFinding[] =>
	paths.map((path, index) => ({
		rule: 'multi-export',
		severity: 'advisory',
		siteKey: `multi-export:${path}:${index}`,
		files: [{ path }],
		detail: 'two exports',
	}));

/** `count` paths under `dir`, distinct filenames apiece. */
const under = ({ dir, count }: { dir: string; count: number }) => Array.from({ length: count }, (_, index) => `${dir}/widget${index}.ts`);

describe('buildDominantPathNote', () => {
	test('a report dominated by one deep directory names it, its share, and the config list that would exclude it', () => {
		const note = buildDominantPathNote({ findings: setupFindings({ paths: [...under({ dir: 'src/generated', count: 22 }), 'lib/thing.ts'] }) });

		expect(note).toContain('sit under src/generated/');
		expect(note).toContain('(22/23)');
		// naming the directory is only half of it — the note says what to do about it
		expect(note).toContain('"generated" list');
	});

	test('the dominant directory is the deepest one still holding the majority of the whole report', () => {
		const paths = [...under({ dir: 'src/generated/alpha', count: 10 }), ...under({ dir: 'src/generated/beta', count: 10 }), ...under({ dir: 'lib', count: 4 })];

		const note = buildDominantPathNote({ findings: setupFindings({ paths }) });

		// the walk descends to the crowded tree and stops where it forks — neither
		// branch holds a majority of the whole report
		expect(note).toContain('sit under src/generated/');
		expect(note).not.toContain('alpha');
		expect(note).not.toContain('beta');
		// the findings outside the tree are real, so the share is a share, not a whole
		expect(note).not.toContain('100%');
	});

	test('a directory one segment deep is not a diagnosis — a whole src/ tree is where code lives, not a config gap', () => {
		expect(buildDominantPathNote({ findings: setupFindings({ paths: under({ dir: 'src', count: 22 }) }) })).toBe(undefined);
	});

	test('a small report is never diagnosed — twenty findings is the floor', () => {
		expect(buildDominantPathNote({ findings: setupFindings({ paths: under({ dir: 'src/generated', count: 19 }) }) })).toBe(undefined);
	});
});
