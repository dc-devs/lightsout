import { describe, expect, test } from '@jest/globals';
import { ProseFile } from '#src/contracts/index.ts';
import { parseProseFiles } from '#src/plan/common/parsing/parseProseFiles.ts';

/** The section as it sits in a plan file: its bullets under the heading, numbered from line 40. */
const parse = ({ bullets }: { bullets: string[] }) => parseProseFiles({ sectionLines: ['', ...bullets], firstLine: 40 });

describe('parseProseFiles', () => {
	test('reads the path and the reason, numbered by where the bullet sits in the plan file', () => {
		const { files, malformedLines } = parse({ bullets: ['- `docs/configuration.md` — a document has no behaviour a test states'] });

		expect(files).toStrictEqual([{ path: 'docs/configuration.md', reason: 'a document has no behaviour a test states', line: 41 }]);
		expect(malformedLines).toStrictEqual([]);
	});

	test('a bullet naming a path but stating no reason is malformed — the exemption exists because of its reason', () => {
		const { files, malformedLines } = parse({ bullets: ['- `docs/configuration.md`'] });

		expect(files).toStrictEqual([]);
		expect(malformedLines).toStrictEqual([41]);
	});

	test('a dash with nothing after it is no reason either', () => {
		expect(parse({ bullets: ['- `docs/configuration.md` — '] }).malformedLines).toStrictEqual([41]);
	});

	test('a bullet whose backticked span holds only spaces names no path, so it is malformed', () => {
		const { files, malformedLines } = parse({ bullets: ['- `  ` — a document states no behaviour'] });

		expect(files).toStrictEqual([]);
		expect(malformedLines).toStrictEqual([41]);
	});

	test('a bullet with no backticked span is ignored rather than reported, because it names nothing', () => {
		// the prose-path check already reports every backticked span naming nothing
		expect(parse({ bullets: ['- nothing user-facing here'] })).toStrictEqual({ files: [], malformedLines: [] });
	});

	test('a line that is not a bullet is skipped, so the section may carry prose', () => {
		const { files } = parse({ bullets: ['These files carry no testable behaviour.', '- `plugin.json` — a version stamp'] });

		expect(files.map(({ path, line }) => ({ path, line }))).toStrictEqual([{ path: 'plugin.json', line: 42 }]);
	});

	test('a file it returns is one the ProseFile contract accepts — a path, a reason, and a positive line', () => {
		const { files } = parse({ bullets: ['- `docs/configuration.md` — a document has no behaviour a test states'] });

		const checked = ProseFile.safeParse(files[0]);

		expect(checked.success).toBe(true);
	});

	test('an absent section yields no files and nothing malformed', () => {
		expect(parseProseFiles({ sectionLines: undefined, firstLine: 1 })).toStrictEqual({ files: [], malformedLines: [] });
	});
});
