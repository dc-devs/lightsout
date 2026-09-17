import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { StandardsCheckModule, StandardsSet } from '#src/contracts/index.ts';
import { StandardsSeverity } from '#src/contracts/index.ts';
import { parseDeclaration } from '#src/standardsPacks/common/parsing/parseDeclaration.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';
import { hasFile } from '#src/standardsPacks/common/utils/hasFile.ts';
import { importCheckModule } from '#src/standardsPacks/common/utils/importCheckModule.ts';

interface Params {
	/** Absolute rule folder path. */
	folderPath: string;
	set: StandardsSet;
	documentPath: string;
	/** Sink for structural/honesty problems — the loader throws them as one batch. */
	problems: string[];
}

/** What rule.md may declare. Everything but the summary has a default, so a rule states only what differs. */
const ruleDeclaration = z.object({
	summary: z.string().min(1),
	checked: z.boolean().default(false),
	severity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory]).default(StandardsSeverity.Advisory),
	settings: z.record(z.string(), z.number()).default({}),
});

/** rule.md read: what it declares and the prose it argues. Either part is absent when the file cannot supply it. */
const getRuleDeclaration = async ({ folderPath, rulePath, found }: { folderPath: string; rulePath: string; found: string[] }) => {
	const filePath = `${rulePath}/rule.md`;
	const text = await readFile(join(folderPath, 'rule.md'), 'utf8').catch((error: unknown) => {
		found.push(`${filePath}: unreadable — ${messageOf({ error })}`);

		return undefined;
	});
	const parsed = text === undefined ? undefined : parseDeclaration({ text, schema: ruleDeclaration, filePath, problems: found });

	return { declaration: parsed?.declaration, prose: parsed?.body ?? '' };
};

/**
 * Read one rule folder — its id, its declaration, its prose, and its check.
 *
 * Every structural and honesty problem is pushed to `problems` rather than
 * thrown, so one load reports every fault in the pack at once. A rule with
 * any problem is dropped whole: a partial rule would be a check that silently
 * stopped running, or prose that silently stopped being injected.
 *
 * @param folderPath - absolute path of the `<NN>-<rule-id>` folder
 * @param set - which document tree the rule belongs to
 * @param documentPath - pack-relative path of the owning document folder
 * @param problems - sink the loader throws as one batch
 */
export const parseRuleFolder = async ({ folderPath, set, documentPath, problems }: Params): Promise<LoadedStandardsRule | undefined> => {
	const folderName = basename(folderPath);
	const rulePath = `${documentPath}/${folderName}`;
	const found: string[] = [];
	const id = /^\d+-(.+)$/.exec(folderName)?.[1];

	if (id === undefined) {
		found.push(`${rulePath}: rule folder must be named <NN>-<rule-id>, e.g. 01-${folderName}`);
	}

	const { declaration, prose } = await getRuleDeclaration({ folderPath, rulePath, found });
	const checkPath = join(folderPath, 'check.ts');
	const hasCheck = await hasFile({ path: checkPath });

	if (declaration?.checked === true && !hasCheck) {
		found.push(`${rulePath}: declares checked: true but ships no check.ts`);
	}

	if (declaration?.checked === false && hasCheck) {
		found.push(`${rulePath}: ships a check.ts but does not declare checked: true`);
	}

	// Recorded, never required: a shipped pack may carry rules without the
	// fixtures that proved them, the way a bundle ships without its tests.
	// `standards-validate` is where the pair is demanded.
	const fixturesPath = join(folderPath, 'fixtures');

	let check: StandardsCheckModule | undefined;

	if (declaration?.checked === true && hasCheck) {
		try {
			check = await importCheckModule({ checkPath });
		} catch (error) {
			found.push(`${rulePath}: ${messageOf({ error })}`);
		}
	}

	problems.push(...found);

	let rule: LoadedStandardsRule | undefined;

	if (found.length === 0 && id !== undefined && declaration !== undefined) {
		rule = {
			id,
			set,
			documentPath,
			summary: declaration.summary,
			prose,
			// The owning document stamps its own channel over this default.
			channel: 'base',
			checked: declaration.checked,
			defaultSeverity: declaration.severity,
			defaultSettings: declaration.settings,
			...(check === undefined ? {} : { inputKind: check.inputKind, run: check.run }),
			fixturesPath,
		};
	}

	return rule;
};
