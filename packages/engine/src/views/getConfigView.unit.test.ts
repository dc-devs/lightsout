import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type ConfigView, StandardsSeverity } from '#src/contracts/index.ts';
import { ConfigNotFoundError } from '#src/views/ConfigNotFoundError.ts';
import { getConfigView } from '#src/views/getConfigView.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/** This repo's own root — the config the view is read against, so the assertions describe a real file rather than a fixture of one. */
const repoRoot = join(__dirname, '..', '..', '..', '..');

/** A directory this repo has, with no config in it — what "no config here" looks like without reaching outside the checkout. */
const withoutConfig = join(repoRoot, 'packages');

/** One row out of the grouped sections, by the key the file would spell. */
const findField = ({ sections, key }: { sections: ConfigView['sections']; key: string }) =>
	sections.flatMap((section) => section.fields).find((field) => field.key === key);

/**
 * A repo whose config text is the case itself — a file the schema will refuse,
 * which `seedConfiguredCwd` cannot write because it only serialises valid
 * objects.
 */
const setupRawConfig = async ({ raw }: { raw: string }) => {
	const cwd = await freshCwd();

	await writeFile(join(cwd, 'lightsout.config.json'), raw, 'utf8');

	return { cwd };
};

/**
 * A repo that declares a standards pack of its own, holding one rule under a
 * base document and a second document that declares the react channel — so what
 * the view reports about the pack can only have come from the pack's own files.
 */
const setupDeclaredPack = async () => {
	const cwd = await seedConfiguredCwd({ config: { 'standards-packs': ['standards/house'] } });
	const files: Record<string, string> = {
		'lightsout-standards.json': '{ "name": "house", "formatVersion": 1 }\n',
		'code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		'code/demo/01-house-rule/rule.md': '---\nsummary: what house-rule catches\n---\n\nThe rule prose.\n',
		'code/react-demo/document.md': '---\nchannel: react\n---\n\n# React demo\n\nProse this pack applies only to react repos.\n',
	};

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, 'standards', 'house', path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { cwd };
};

describe('getConfigView', () => {
	test('marks a key this repo actually wrote as coming from its config', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(findField({ sections: view.sections, key: 'gates' })?.fromConfig).toBe(true);
	});

	test('marks a key the file omits as lightsout filling it in', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(findField({ sections: view.sections, key: 'packages-dir' })?.fromConfig).toBe(false);
	});

	test("hands an omitted key the engine's own default rather than a second copy of the number", async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(findField({ sections: view.sections, key: 'packages-dir' })?.value).toBe('packages');
		expect(findField({ sections: view.sections, key: 'executor-file-limit' })?.value).toBe(50);
	});

	test('flattens the timeouts block to its two leaves, so a file setting one does not claim the other', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(findField({ sections: view.sections, key: 'timeouts.agent-minutes' })?.value).toBe(60);
		expect(findField({ sections: view.sections, key: 'timeouts.supervisor-minutes' })?.value).toBe(15);
	});

	test('leaves a key with no named default null, which is the row that reads "default: none"', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(findField({ sections: view.sections, key: 'package-gates' })?.fromConfig).toBe(true);
		expect(findField({ sections: view.sections, key: 'standards-channels' })?.value).toBeNull();
	});

	test("carries the schema's own sentence for every row, so the page and the contract cannot disagree", async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(view.sections.flatMap((section) => section.fields).every((field) => field.description.length > 0)).toBe(true);
	});

	test.each([
		{ harness: 'claude-code', model: 'claude-opus-5' },
		{ harness: 'codex', model: 'gpt-5.6-terra' },
	])('states the configured $harness harness and $model model at the top level', async ({ harness, model }) => {
		const cwd = await seedConfiguredCwd({ config: { harness, model } });
		const view = await getConfigView({ cwd });

		expect(view.harness).toBe(harness);
		expect(view.model).toBe(model);
	});

	test('names the packs this config loads, each with the channels its own documents declare', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(view.packs.length).toBeGreaterThan(0);
		expect(view.packs[0].isDefault).toBe(true);
		expect(view.packs[0].channels).toContain('base');
	});

	test('records the pack behind every rule, which is what the ledger links with', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(view.ruleStates.every((state) => state.pack === view.packs[0].name)).toBe(true);
	});

	test('reports a rule this repo turned up as set by config, at the severity the file asked for', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		const sizeFile = view.ruleStates.find((state) => state.rule === 'size-file');

		expect(sizeFile).toMatchObject({ fromConfig: true, severity: StandardsSeverity.Blocking });
	});

	test('says a repo with no config has none, rather than answering with the defaults it would have used', async () => {
		await expect(getConfigView({ cwd: withoutConfig })).rejects.toThrow(ConfigNotFoundError);
	});

	test('groups the file into the areas the page reads, in the order it reads them', async () => {
		const view = await getConfigView({ cwd: repoRoot });

		expect(view.sections.map((section) => section.title)).toStrictEqual([
			'Harness',
			'Gates',
			'Standards',
			'Agent commands',
			'Generated',
			'Timeouts',
			'Ship',
			'Queue',
			'Auto plan',
			'Docs',
		]);
	});

	test('shows the ship block whole in its own area, because no leaf of it has a default worth a row of its own', async () => {
		const cwd = await seedConfiguredCwd({
			config: { ship: { 'ticket-pattern': '^(?<ticket>ab-\\d+)', 'pr-body': 'Closes {ticket}', 'merge-method': 'squash' } },
		});

		const view = await getConfigView({ cwd });

		const ship = view.sections.find((section) => section.title === 'Ship');

		expect(ship?.fields).toEqual([
			expect.objectContaining({
				key: 'ship',
				value: { 'ticket-pattern': '^(?<ticket>ab-\\d+)', 'pr-body': 'Closes {ticket}', 'merge-method': 'squash' },
				fromConfig: true,
			}),
		]);
	});

	test('leaves ship null when the file omits it, because ship is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'ship' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the queue block whole in its own area, so the block the document documents is on the page too', async () => {
		const queue = {
			tracker: 'linear',
			team: 'AB',
			'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
			'max-parallel': 2,
			'api-key-env': 'TRACKER_API_KEY',
		};
		const cwd = await seedConfiguredCwd({ config: { queue } });

		const view = await getConfigView({ cwd });

		const queueSection = view.sections.find((section) => section.title === 'Queue');

		expect(queueSection?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({ key: 'queue', value: queue, fromConfig: true, description: expect.stringContaining('tracker') }),
		]);
	});

	test('leaves queue null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'queue' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the auto-plan block whole in its own area, because no leaf of it has a default worth a row of its own', async () => {
		const cwd = await seedConfiguredCwd({ config: { 'auto-plan': { 'implement-on-approval': true, 'auto-approve-plan': false } } });

		const view = await getConfigView({ cwd });

		const autoPlan = view.sections.find((section) => section.title === 'Auto plan');

		expect(autoPlan?.fields).toEqual([
			expect.objectContaining({ key: 'auto-plan', value: { 'implement-on-approval': true, 'auto-approve-plan': false }, fromConfig: true }),
		]);
	});

	test('leaves auto-plan null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'auto-plan' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the docs block whole in its own area, so a declared surface and what it covers are both on the page', async () => {
		const docs = [
			{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
			{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
		];
		const cwd = await seedConfiguredCwd({ config: { docs } });

		const view = await getConfigView({ cwd });

		const docsSection = view.sections.find((section) => section.title === 'Docs');

		expect(docsSection?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({ key: 'docs', value: docs, fromConfig: true, description: expect.stringContaining('covers') }),
		]);
	});

	test('leaves docs null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'docs' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('leaves the harness and the model null when the file names neither, rather than inventing a fallback for them', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		// the strip drops the chip it has no answer for; what the engine would fall
		// back to at run time is the Harness section's story, not this view's
		expect(view).toEqual(expect.objectContaining({ harness: null, model: null }));
	});

	test('reads the harness and the model off a file that does name them, where the repo strip looks', async () => {
		const cwd = await seedConfiguredCwd({ config: { harness: 'codex', model: 'gpt-5.2' } });

		const view = await getConfigView({ cwd });

		expect(view).toEqual(expect.objectContaining({ harness: 'codex', model: 'gpt-5.2' }));
	});

	test('carries a configured channel list verbatim, because a repo that named its channels is not detecting them', async () => {
		const cwd = await seedConfiguredCwd({ config: { 'standards-channels': ['react'] } });

		const view = await getConfigView({ cwd });

		expect(view.channels).toStrictEqual(['react']);
		expect(findField({ sections: view.sections, key: 'standards-channels' })).toEqual(expect.objectContaining({ value: ['react'], fromConfig: true }));
	});

	test('reports a declared pack as the repo choosing it, with the channels its own documents declare', async () => {
		const { cwd } = await setupDeclaredPack();

		const view = await getConfigView({ cwd });

		// the config named no channels at all — 'react' can only have come from the
		// pack's second document, which is the point of a per-pack channel list
		expect(view.packs).toEqual([expect.objectContaining({ name: 'house', isDefault: false, channels: ['base', 'react'] })]);
	});

	test('names the declaring pack on a rule that came from a declared pack, which is what the ledger links with', async () => {
		const { cwd } = await setupDeclaredPack();

		const view = await getConfigView({ cwd });

		expect(view.ruleStates).toEqual([expect.objectContaining({ rule: 'house-rule', pack: 'house' })]);
	});

	test('a config that is not JSON at all comes back as that, rather than as a repo that has no config', async () => {
		const { cwd } = await setupRawConfig({ raw: '{ "gates": ' });

		// the page 404s on absence only; this one has a message the reader can act
		// on, so it travels to the error boundary as itself
		await expect(getConfigView({ cwd })).rejects.toThrow(/is not valid JSON/);
	});

	test('a config the schema refuses names the key it refused, which is what the error boundary shows', async () => {
		const { cwd } = await setupRawConfig({ raw: JSON.stringify({ gates: { check: 'pnpm check' } }) });

		await expect(getConfigView({ cwd })).rejects.toThrow(/gates\.test/);
	});
});
