import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule, with the test files held out of the scope it judges. */
const setupRepo = ({ contents, tests = [] }: { contents: Array<[string, string]>; tests?: string[] }) => {
	return setupFileTextInput({ contents, tests, source: contents.map(([path]) => path).filter((path) => !tests.includes(path)) });
};

/** A file the engine listed in scope but whose text it could not read, so `contents` holds no entry for it. */
const setupUnreadableFileInput = ({ path }: { path: string }) => {
	return setupFileTextInput({ files: [path], source: [path] });
};

describe('filename-mismatch check', () => {
	test('asks for file text, since the export it compares against is inside the file', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a file whose only export is called something else', async () => {
		const input = setupRepo({ contents: [['src/billing/chargeLabel.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'filename-mismatch:src/billing/chargeLabel.ts',
				files: [{ path: 'src/billing/chargeLabel.ts' }],
				detail: "file 'chargeLabel' exports 'getChargeLabel'",
				guidance: 'The filename should match the export it holds.',
			},
		]);
	});

	test('accepts a file named after its export', async () => {
		const input = setupRepo({ contents: [['src/billing/getChargeLabel.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ path: 'src/events/events.service.ts', declaration: 'export class EventsService {', shape: 'a framework dot-suffix' },
		{ path: 'src/users/user.model.ts', declaration: 'export class User {', shape: 'an export named for the part before a framework dot-suffix' },
		{ path: 'src/routes/get-started.ts', declaration: 'export const getStarted = (): number => 1;', shape: 'a kebab-case route file' },
		{ path: 'src/components/UserProfile.tsx', declaration: 'export const UserProfile = (): null => null;', shape: 'a PascalCase component' },
	])('accepts $shape, whose casing the framework dictates', async ({ path, declaration }) => {
		const input = setupRepo({ contents: [[path, declaration]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file holding two exports, which the one-export-per-file rule owns', async () => {
		const input = setupRepo({
			contents: [['src/config/config.ts', ['export interface Config {', '\tname: string;', '}', '', 'export const defaultConfig = { name: 1 };'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file whose text the engine could not read', async () => {
		const input = setupUnreadableFileInput({ path: 'src/billing/chargeLabel.ts' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file that exports no declaration of its own', async () => {
		const input = setupRepo({ contents: [['src/billing/chargeLabel.ts', "export { getChargeLabel } from '@/billing/getChargeLabel';"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a barrel, which declares nothing of its own', async () => {
		const input = setupRepo({ contents: [['src/billing/index.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a test file, which the test standards name after its subject', async () => {
		const input = setupRepo({
			contents: [['src/billing/getChargeLabel.unit.test.ts', 'export const setupCharge = (): number => 1;']],
			tests: ['src/billing/getChargeLabel.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("ignores a route file, whose name the package's router mandates", async () => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-router": "^1.0.0" } }'],
				['packages/web-app/src/routes/runs.$runId.tsx', 'export const Route = createFileRoute();'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still reports a misnamed file elsewhere in the same router package, so the exemption is the directory', async () => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-router": "^1.0.0" } }'],
				['packages/web-app/src/runs/chargeLabel.ts', 'export const getChargeLabel = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'filename-mismatch:packages/web-app/src/runs/chargeLabel.ts',
				files: [{ path: 'packages/web-app/src/runs/chargeLabel.ts' }],
				detail: "file 'chargeLabel' exports 'getChargeLabel'",
				guidance: 'The filename should match the export it holds.',
			},
		]);
	});

	test('reports a routes/ file in a package that declares no router, since nothing mandates the name there', async () => {
		const input = setupRepo({
			contents: [
				['packages/engine/package.json', '{ "dependencies": { "zod": "^4.0.0" } }'],
				['packages/engine/src/routes/chargeLabel.ts', 'export const getChargeLabel = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.files).toStrictEqual([{ path: 'packages/engine/src/routes/chargeLabel.ts' }]);
	});

	test("ignores an entry file the package's framework resolves by convention", async () => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-start": "^1.0.0" } }'],
				['packages/web-app/src/router.tsx', 'export const getRouter = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("ignores NestJS's bootstrap entry, whose name the framework resolves the same way", async () => {
		const input = setupRepo({
			contents: [
				['packages/api/package.json', '{ "dependencies": { "@nestjs/core": "^11.0.0" } }'],
				['packages/api/src/main.ts', 'export const bootstrap = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still reports a file of that name sitting deeper than the framework resolves it, so the anchoring holds', async () => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-start": "^1.0.0" } }'],
				['packages/web-app/src/app/router.tsx', 'export const getRouter = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'filename-mismatch:packages/web-app/src/app/router.tsx',
				files: [{ path: 'packages/web-app/src/app/router.tsx' }],
				detail: "file 'router' exports 'getRouter'",
				guidance: 'The filename should match the export it holds.',
			},
		]);
	});

	test.each([
		{ path: 'packages/web-app/src/server.ts', declaration: 'export const handler = (): number => 1;', entry: 'the server entry' },
		{ path: 'packages/web-app/src/client.tsx', declaration: 'export const hydrate = (): null => null;', entry: 'the client entry' },
	])("ignores $entry too, since the exemption is the framework's whole entry list", async ({ path, declaration }) => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-start": "^1.0.0" } }'],
				[path, declaration],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores an entry file of a package whose manifest sits at the repo root, where the anchor is the root src/', async () => {
		const input = setupRepo({
			contents: [
				['package.json', '{ "dependencies": { "@nestjs/core": "^11.0.0" } }'],
				['src/main.ts', 'export const bootstrap = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still reports that same entry file where the declared framework resolves no entry files, so the dependency is what exempts it', async () => {
		const input = setupRepo({
			contents: [
				['packages/web-app/package.json', '{ "dependencies": { "@tanstack/react-router": "^1.0.0" } }'],
				['packages/web-app/src/router.tsx', 'export const getRouter = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'filename-mismatch:packages/web-app/src/router.tsx',
				files: [{ path: 'packages/web-app/src/router.tsx' }],
				detail: "file 'router' exports 'getRouter'",
				guidance: 'The filename should match the export it holds.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
