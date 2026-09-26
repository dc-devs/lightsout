import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSeverity } from '#src/contracts/standardsCheck/StandardsSeverity.ts';
import { parseRuleFolder } from '#src/standardsPacks/internal/common/parsing/parseRuleFolder.ts';

/** One rule folder on disk, declaring the given front matter, with nothing else in it. */
const setupRuleFolder = ({ frontMatter }: { frontMatter: string }) => {
	const folderPath = join(mkdtempSync(join(tmpdir(), 'lightsout-rule-')), '01-internal-import-from-outside');

	mkdirSync(folderPath, { recursive: true });
	writeFileSync(join(folderPath, 'rule.md'), `---\n${frontMatter}\n---\n\nPrivate files live in internal/.\n`);

	return { folderPath };
};

describe('parseRuleFolder', () => {
	test('reads a rule the pack ships off, for a repo to opt into', async () => {
		const { folderPath } = setupRuleFolder({ frontMatter: 'summary: an internal file imported from outside\nseverity: off' });
		const problems: string[] = [];

		const rule = await parseRuleFolder({ folderPath, set: 'code', documentPath: 'code/modules', problems });

		expect({ id: rule?.id, defaultSeverity: rule?.defaultSeverity, problems }).toStrictEqual({
			id: 'internal-import-from-outside',
			defaultSeverity: StandardsSeverity.Off,
			problems: [],
		});
	});

	test('defaults a rule that states no severity to advisory', async () => {
		const { folderPath } = setupRuleFolder({ frontMatter: 'summary: an internal file imported from outside' });

		const rule = await parseRuleFolder({ folderPath, set: 'code', documentPath: 'code/modules', problems: [] });

		expect(rule?.defaultSeverity).toBe(StandardsSeverity.Advisory);
	});

	test('refuses a severity the pack format does not know, and drops the rule', async () => {
		const { folderPath } = setupRuleFolder({ frontMatter: 'summary: an internal file imported from outside\nseverity: loud' });
		const problems: string[] = [];

		const rule = await parseRuleFolder({ folderPath, set: 'code', documentPath: 'code/modules', problems });

		expect({ rule, problemCount: problems.length }).toStrictEqual({ rule: undefined, problemCount: 1 });
	});
});
