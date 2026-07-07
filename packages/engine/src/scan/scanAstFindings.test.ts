import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runScan } from './index';

const setupRepo = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-ast-'));

	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}

	// The AST tier borrows the consumer's TypeScript — hand the fixture ours,
	// or runScan degrades the ast-duplicate detector to a skip.
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

// Bodies must clear minBodyTokens (40) to be duplicate candidates — the
// padding statements exist purely to cross that floor.
const wrapper = ({ name, hook }: { name: string; hook: string }) => `
export const ${name} = ({ id }: { id: number }) => {
	const mutation = ${hook}();
	const first = mutation.a + mutation.b + mutation.c + mutation.d;
	const second = first + mutation.e + mutation.f + mutation.g + mutation.h;
	const third = second + mutation.i + mutation.j + mutation.k + mutation.l;

	return { id, mutation, first, second, third };
};
`;

test('ast-duplicate: wrappers binding DIFFERENT use* hooks are not duplicates; identical hooks still are', async () => {
	const dir = setupRepo({
		'github.ts': wrapper({ name: 'GitHubButton', hook: 'useCreateGitHubInstallation' }),
		'linear.ts': wrapper({ name: 'LinearButton', hook: 'useCreateLinearInstallation' }),
		// Same hook, only non-hook identifiers renamed — a genuine systematic-rename duplicate.
		'copyA.ts': wrapper({ name: 'AlphaButton', hook: 'useSharedThing' }).replace(/mutation/g, 'alpha'),
		'copyB.ts': wrapper({ name: 'BetaButton', hook: 'useSharedThing' }).replace(/mutation/g, 'beta'),
	});

	const { findings } = await runScan({ cwd: dir, persist: false });
	const duplicates = findings.filter((finding) => finding.detector === 'ast-duplicate');

	assert.equal(duplicates.length, 1, `expected exactly the same-hook pair flagged, got: ${JSON.stringify(duplicates)}`);
	assert.deepEqual(
		duplicates[0]?.files.map((file) => file.path).sort(),
		['copyA.ts', 'copyB.ts'],
		'only the pair calling the SAME hook is a duplicate — different hooks make bodies distinct',
	);
});
