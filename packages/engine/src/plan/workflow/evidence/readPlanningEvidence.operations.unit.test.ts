import { execFileSync } from 'node:child_process';
import { rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { type PlanningEvidenceRequest, PlanningVocabulary } from '#src/contracts/index.ts';
import { fingerprintPlanningDependencies, readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	await context.write('src/action.ts', 'export const action = () => upload();\n// Retry preserves café\n');
	return context;
};
test('returns exact Unicode source and a content dependency for a direct file read', async () => {
	const { runtime } = await setup();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: { requestId: 'file', operation: PlanningVocabulary.Operation.ReadFile, path: 'src/action.ts', reason: 'Inspect implementation' },
	});

	expect(result.content).toBe('export const action = () => upload();\n// Retry preserves café\n');
	expect(result.evidence).toEqual(
		expect.objectContaining({
			conclusion: '',
			complete: true,
			sourceIds: ['src/action.ts'],
			dependencyReach: 'known',
			dependencies: [expect.objectContaining({ kind: 'content', path: 'src/action.ts' })],
		}),
	);
});
test('returns numbered requested lines while retaining whole-file freshness', async () => {
	const { runtime } = await setup();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: {
			requestId: 'range',
			operation: PlanningVocabulary.Operation.ReadRange,
			path: 'src/action.ts',
			startLine: 2,
			endLine: 2,
			reason: 'Inspect retry invariant',
		},
	});

	expect(result.content).toBe('2: // Retry preserves café');
	expect(result.evidence.dependencies).toEqual([expect.objectContaining({ kind: 'content', path: 'src/action.ts' })]);
});
test('rejects a requested line range beyond the available file', async () => {
	const { runtime } = await setup();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: {
				requestId: 'range',
				operation: PlanningVocabulary.Operation.ReadRange,
				path: 'src/action.ts',
				startLine: 1,
				endLine: 100,
				reason: 'Inspect implementation',
			},
		}),
	).rejects.toThrow(/range exceeds/);
});
const setupListing = async () => {
	const context = await setup();
	await context.write('src/z.ts', 'last');
	await context.write('src/nested/a.ts', 'nested');
	await context.write('src/ignored/file.ts', 'ignored');
	const request: PlanningEvidenceRequest = {
		requestId: 'list',
		operation: PlanningVocabulary.Operation.List,
		root: 'src',
		exclude: ['src/ignored', 'src/ignored/**'],
		reason: 'Find source membership',
	};
	return { ...context, request };
};
test('lists deterministic membership while preserving explicit exclusions', async () => {
	const { runtime, request } = await setupListing();

	const result = await readPlanningEvidence({ runtime, assignmentId: 'investigator', request });

	expect(JSON.parse(result.content)).toStrictEqual([
		{ path: 'src', kind: 'directory' },
		{ path: 'src/action.ts', kind: 'file' },
		{ path: 'src/nested', kind: 'directory' },
		{ path: 'src/nested/a.ts', kind: 'file' },
		{ path: 'src/z.ts', kind: 'file' },
	]);
	expect(result.evidence.dependencies[0]).toEqual(
		expect.objectContaining({
			kind: 'membership',
			root: 'src',
			policy: { exclude: ['.git', '.git/**', '.lightsout', '.lightsout/**', 'src/ignored', 'src/ignored/**'] },
		}),
	);
});
const exerciseMembership = async (context: Awaited<ReturnType<typeof setupListing>>) => {
	const { cwd, runtime, request, write, record, standards, policy } = context;
	const initial = await readPlanningEvidence({ runtime, assignmentId: 'investigator', request });
	await write('src/action.ts', 'only content changed');
	const content = await fingerprintPlanningDependencies({ cwd, dependencies: initial.evidence.dependencies, record, standards, policy });
	await write('src/new.ts', 'new member');
	const membership = await fingerprintPlanningDependencies({ cwd, dependencies: initial.evidence.dependencies, record, standards, policy });
	return { content: content.current, membership: membership.current };
};
test('reuses a membership observation across content edits but invalidates new members', async () => {
	const context = await setupListing();

	const result = await exerciseMembership(context);

	expect(result).toStrictEqual({ content: true, membership: false });
});
const setupRegex = async () => {
	const context = await setup();
	await context.write('src/upper.ts', 'UPLOAD();\nwait();');
	await context.write('src/non-code.txt', 'UPLOAD();');
	return context;
};
test('applies regex case policy and glob before reporting matching lines', async () => {
	const { runtime } = await setupRegex();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: {
			requestId: 'search',
			operation: PlanningVocabulary.Operation.Search,
			roots: ['src'],
			query: '^upload\\(',
			options: { regex: true, caseSensitive: false, glob: '**/*.ts', exclude: [] },
			reason: 'Inspect direct calls',
		},
	});

	expect(JSON.parse(result.content)).toStrictEqual([{ path: 'src/upper.ts', line: 1, text: 'UPLOAD();' }]);
});
test('rejects invalid regex before searching unavailable roots', async () => {
	const { runtime } = await setup();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: {
				requestId: 'bad-regex',
				operation: PlanningVocabulary.Operation.Search,
				roots: ['missing'],
				query: '[',
				options: { regex: true, caseSensitive: true, glob: '**/*', exclude: [] },
				reason: 'Inspect direct calls',
			},
		}),
	).rejects.toThrow(SyntaxError);
});
const setupBinary = async () => {
	const context = await setup();
	await writeFile(join(context.cwd, 'src/binary.bin'), Buffer.from([0xff, 0xfe, 0]));
	return context;
};
test('rejects non-text direct reads rather than returning lossy replacement characters', async () => {
	const { runtime } = await setupBinary();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'binary', operation: PlanningVocabulary.Operation.ReadFile, path: 'src/binary.bin', reason: 'Read requested bytes' },
		}),
	).rejects.toThrow(/not UTF-8/);
});
const setupParentLink = async () => {
	const context = await setup();
	await symlink(join(context.cwd, 'src'), join(context.cwd, 'link'));
	return context;
};
test('refuses a missing descendant through a symbolic-link ancestor', async () => {
	const { runtime } = await setupParentLink();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'linked', operation: PlanningVocabulary.Operation.ReadFile, path: 'link/missing.ts', reason: 'Check absence' },
		}),
	).rejects.toThrow(/symbolic link/);
});
test('rejects directory inputs to a file request', async () => {
	const { runtime } = await setup();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'directory', operation: PlanningVocabulary.Operation.ReadFile, path: 'src', reason: 'Read file' },
		}),
	).rejects.toThrow(/not a regular file/);
});

const setupFifo = async () => {
	const context = await setup();
	execFileSync('mkfifo', [join(context.cwd, 'src/stream')]);
	return context;
};
test('rejects a named pipe without waiting for a writer', async () => {
	const { runtime } = await setupFifo();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'fifo', operation: PlanningVocabulary.Operation.ReadFile, path: 'src/stream', reason: 'Inspect requested source' },
		}),
	).rejects.toThrow(/not a regular file/);
});

const setupBinarySearch = async () => {
	const context = await setupRegex();
	await writeFile(join(context.cwd, 'src/binary.ts'), Buffer.from([0xff, 0xfe]));
	return context;
};
test('searches text without treating binary members as lossy text matches', async () => {
	const { runtime } = await setupBinarySearch();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: {
			requestId: 'literal',
			operation: PlanningVocabulary.Operation.Search,
			roots: ['src', 'src/upper.ts'],
			query: 'upload',
			options: { regex: false, caseSensitive: false, glob: '**/*.ts', exclude: [] },
			reason: 'Find every textual caller',
		},
	});

	expect(JSON.parse(result.content).map((item: { path: string }) => item.path)).toStrictEqual(['src/action.ts', 'src/upper.ts']);
	expect(result.evidence.dependencyReach).toBe('known');
});
test('records an absent search root as an observed empty namespace', async () => {
	const { runtime } = await setup();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: {
			requestId: 'missing-root',
			operation: PlanningVocabulary.Operation.Search,
			roots: ['missing'],
			query: 'upload',
			options: { regex: true, caseSensitive: true, glob: '**/*', exclude: [] },
			reason: 'Check whether the adapter exists',
		},
	});

	expect(JSON.parse(result.content)).toStrictEqual([]);
	expect(result.evidence.dependencies).toEqual([expect.objectContaining({ kind: 'search', roots: ['missing'] })]);
});
test('marks special-file membership as unknown reach without opening it', async () => {
	const { runtime } = await setupFifo();

	const result = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: { requestId: 'special-members', operation: PlanningVocabulary.Operation.List, root: 'src', exclude: [], reason: 'Inspect namespace' },
	});

	expect(JSON.parse(result.content)).toEqual(expect.arrayContaining([{ path: 'src/stream', kind: 'other' }]));
	expect(result.evidence.dependencyReach).toBe('unknown');
	expect(result.evidence.dependencies.map((dependency) => dependency.kind)).toStrictEqual(['membership', 'unknown']);
});
test('rejects traversal through a regular-file ancestor rather than inferring absence', async () => {
	const { runtime } = await setup();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'bad-parent', operation: PlanningVocabulary.Operation.ReadFile, path: 'src/action.ts/child.ts', reason: 'Inspect requested path' },
		}),
	).rejects.toThrow(/ancestor is not a directory/);
});

test('propagates filesystem lookup failures rather than recording false absence', async () => {
	const { runtime } = await setup();

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'lookup', operation: PlanningVocabulary.Operation.ReadFile, path: 'x'.repeat(300), reason: 'Inspect requested source' },
		}),
	).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
});
