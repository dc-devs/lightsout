import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StandardsSet } from '#src/contracts/index.ts';
import { parseDeclaration } from '#src/standardsPacks/common/parsing/parseDeclaration.ts';
import { parseRuleFolder } from '#src/standardsPacks/common/parsing/parseRuleFolder.ts';
import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';
import { hasFile } from '#src/standardsPacks/common/utils/hasFile.ts';

interface Params {
	/** Absolute document folder path (contains document.md). */
	folderPath: string;
	/** Pack-relative path of the folder. */
	documentPath: string;
	set: StandardsSet;
	problems: string[];
}

/**
 * What document.md may declare. A document that names no channel is base — it
 * always applies; a named channel means prose, checks and review all sit out
 * unless the repo runs that framework.
 */
const documentDeclaration = z.object({
	channel: z.string().min(1).default('base'),
});

/** The rule folders directly under a document, in assembly (lexicographic) order. */
const listRuleFolders = async ({ folderPath }: { folderPath: string }) => {
	const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
	const directories = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const folders: string[] = [];

	for (const name of directories) {
		const isRule = await hasFile({ path: join(folderPath, name, 'rule.md') });

		if (isRule) {
			folders.push(name);
		}
	}

	return folders;
};

/**
 * Read one document folder: its intro prose, the channel it declares, and every
 * rule folder under it in order. The document's channel is stamped onto each of
 * its rules — prose, check and review move as one unit, so a rule can never be
 * in play while the document that argues for it is not.
 *
 * @param folderPath - absolute path of the folder holding document.md
 * @param documentPath - that folder's pack-relative path
 * @param set - which document tree the folder sits in
 * @param problems - sink the loader throws as one batch
 */
export const parseDocumentFolder = async ({
	folderPath,
	documentPath,
	set,
	problems,
}: Params): Promise<{ document: LoadedStandardsDocument; rules: LoadedStandardsRule[] } | undefined> => {
	const text = await readFile(join(folderPath, 'document.md'), 'utf8').catch(() => undefined);

	if (text === undefined) {
		problems.push(`${documentPath}/document.md: unreadable`);

		return undefined;
	}

	const { declaration, body: intro } = parseDeclaration({
		text,
		schema: documentDeclaration,
		filePath: `${documentPath}/document.md`,
		problems,
	});
	const rules: LoadedStandardsRule[] = [];

	for (const name of await listRuleFolders({ folderPath })) {
		const rule = await parseRuleFolder({ folderPath: join(folderPath, name), set, documentPath, problems });

		if (rule !== undefined && declaration !== undefined) {
			rules.push({ ...rule, channel: declaration.channel });
		}
	}

	let parsedDocument: { document: LoadedStandardsDocument; rules: LoadedStandardsRule[] } | undefined;

	if (declaration !== undefined) {
		parsedDocument = {
			document: { set, path: documentPath, channel: declaration.channel, intro, ruleIds: rules.map((rule) => rule.id) },
			rules,
		};
	}

	return parsedDocument;
};
