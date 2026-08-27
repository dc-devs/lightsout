import { z } from 'zod';
import { StandardsSeverity } from '#src/contracts/standardsCheck/index.ts';
import { ConfigFieldView } from '#src/contracts/views/config/ConfigFieldView.ts';

/** What this repo told lightsout, and what lightsout filled in. */
export const ConfigView = z.object({
	/** Absolute path of the lightsout.config.json that was read. */
	path: z.string(),
	/**
	 * The harness as the file states it, e.g. 'claude-code'; null when unset.
	 *
	 * Typed at the top level because the repo strip reads it directly, and
	 * nullable because this view does not resolve defaults — `resolveConfigAndDriver`
	 * needs a command, and the Harness section is where the fallback is explained.
	 */
	harness: z.string().nullable(),
	/** The model as the file states it, e.g. 'claude-opus-5'; null when unset. Same reason. */
	model: z.string().nullable(),
	/** Grouped for the page: one section per config area. */
	sections: z.array(
		z.object({
			title: z.string(),
			fields: z.array(ConfigFieldView),
		}),
	),
	/** Standards packs this config loads, by name and root path — links into the pack pages. */
	packs: z.array(z.object({ name: z.string(), rootPath: z.string(), isDefault: z.boolean(), channels: z.array(z.string()) })),
	/** The config's `standards-channels` value verbatim; empty when unset (channels are otherwise detected per run, which this view cannot do). */
	channels: z.array(z.string()),
	/** Every loaded rule with its effective severity here and whether config set it. */
	ruleStates: z.array(
		z.object({
			rule: z.string(),
			/** The pack that declares the rule — what the ledger's link to `/standards/$pack/$rule` needs when several packs load. */
			pack: z.string(),
			severity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory, StandardsSeverity.Off]),
			fromConfig: z.boolean(),
			settings: z.record(z.string(), z.number()),
		}),
	),
});

export type ConfigView = z.infer<typeof ConfigView>;
