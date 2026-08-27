import { join } from 'node:path';
import { z } from 'zod';
import { parseConfig } from '#src/common/config/parseConfig.ts';
import { readConfigFile } from '#src/common/config/readConfigFile.ts';
import type { ConfigView } from '#src/contracts/index.ts';
import { listStandardsRules } from '#src/standardsCheck/index.ts';
import { type LoadedStandardsPack, resolveStandardsPacks } from '#src/standardsPacks/index.ts';
import { ConfigNotFoundError } from '#src/views/ConfigNotFoundError.ts';
import { buildConfigSections } from '#src/views/common/utils/buildConfigSections.ts';

/**
 * The file as written, keys only — what `fromConfig` is decided against.
 *
 * Deliberately lenient: this is the same text `parseConfig` has already
 * accepted, and what it is read for here is which keys were typed rather than
 * what they mean.
 */
const DeclaredConfig = z.object({ timeouts: z.record(z.string(), z.unknown()).optional() }).catchall(z.unknown());

/** Every key the file itself wrote, the timeouts block flattened to the two leaves the page gives their own rows. */
const listDeclaredKeys = ({ raw }: { raw: string }) => {
	const declared = DeclaredConfig.parse(JSON.parse(raw));

	return [...Object.keys(declared), ...Object.keys(declared.timeouts ?? {}).map((leaf) => `timeouts.${leaf}`)];
};

/** The distinct framework channels a pack's own documents declare — what a pack row shows beside its name. */
const getPackChannels = ({ pack }: { pack: LoadedStandardsPack }) => [...new Set(pack.documents.map((document) => document.channel))].sort();

/**
 * Which pack declares each rule id.
 *
 * `StandardsRuleListing` carries no pack field, and re-parsing its `doc` display
 * string would be a second format to keep true — so the packs already loaded are
 * what answers, and the ledger's link to a rule page stays correct when several
 * packs load at once.
 */
const mapRuleOwners = ({ packs }: { packs: LoadedStandardsPack[] }) => {
	const owners = new Map<string, string>();

	for (const pack of packs) {
		for (const rule of pack.rules) {
			owners.set(rule.id, pack.name);
		}
	}

	return owners;
};

interface Params {
	cwd: string;
}

/**
 * What this repo told lightsout, and what lightsout filled in.
 *
 * Both halves, because either alone answers half the question: the file is
 * already on the reader's disk, and the defaults it does not mention are the
 * part nobody can look up. Each row says which of the two it is, and every
 * default comes from the engine's own named constants rather than a second
 * table that could disagree with them.
 *
 * @param cwd - the repo whose `lightsout.config.json`, packs and rule states are read
 * @throws {ConfigNotFoundError} When no `lightsout.config.json` exists — the page 404s.
 * @throws {Error} When the file exists but fails to parse — surfaced by the route's error boundary with the zod message, which is the actionable answer.
 */
export const getConfigView = async ({ cwd }: Params): Promise<ConfigView> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readConfigFile({ configPath });

	if (raw === undefined) {
		throw new ConfigNotFoundError({ configPath });
	}

	const config = parseConfig({ raw, configPath });
	const packs = await resolveStandardsPacks({ cwd, config });
	const listings = await listStandardsRules({ cwd, config });
	const owners = mapRuleOwners({ packs });

	return {
		path: configPath,
		harness: config.harness ?? null,
		model: config.model ?? null,
		sections: buildConfigSections({ config, declaredKeys: listDeclaredKeys({ raw }) }),
		// A config naming no pack loads exactly one, and it is the default one —
		// which is what `resolveStandardsPacks` encodes and this reads back rather
		// than deciding for itself.
		packs: packs.map((pack) => ({
			name: pack.name,
			rootPath: pack.rootPath,
			isDefault: config['standards-packs'] === undefined,
			channels: getPackChannels({ pack }),
		})),
		channels: config['standards-channels'] ?? [],
		ruleStates: listings.flatMap((listing) => {
			const pack = owners.get(listing.rule);

			return pack === undefined ? [] : [{ rule: listing.rule, pack, severity: listing.severity, fromConfig: listing.fromConfig, settings: listing.settings }];
		}),
	};
};
