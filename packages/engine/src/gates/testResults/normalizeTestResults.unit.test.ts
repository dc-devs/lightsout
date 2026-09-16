import { expect, test } from '@jest/globals';

// Dependencies

import { mkdir, realpath, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { normalizeTestResults } from '#src/gates/testResults/normalizeTestResults.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

test('matches physical and logical checkout paths without adopting an outside file with the same name', async () => {
	const root = await freshCwd();
	const actual = join(root, 'actual');
	const alias = join(root, 'alias');
	await mkdir(actual);
	await symlink(actual, alias);
	const physical = await realpath(actual);
	const outside = join(root, 'outside', 'named.unit.test.ts');
	const results = [join(alias, 'named.unit.test.ts'), join(physical, 'named.unit.test.ts'), outside].map((testFilePath) => ({
		testFilePath,
		assertionResults: [],
	}));

	const normalized = await normalizeTestResults({ cwd: alias, results });

	expect(normalized.map((file) => file.testFilePath)).toEqual(['named.unit.test.ts', 'named.unit.test.ts', relative(alias, outside)]);
});
