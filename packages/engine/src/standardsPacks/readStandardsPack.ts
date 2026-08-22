import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { standardsPackRootFile } from '#src/common/constants/standardsPackRootFile.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { StandardsPackRoot, StandardsSet } from '#src/contracts/index.ts';
import { parseDocumentFolder } from '#src/standardsPacks/common/parsing/parseDocumentFolder.ts';
import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/common/types/LoadedStandardsPack.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';
import { formatSchemaIssues } from '#src/standardsPacks/common/utils/formatSchemaIssues.ts';

interface Params {
	/** Absolute pack root. */
	packPath: string;
}

interface WalkParams {
	folderPath: string;
	documentPath: string;
	set: StandardsSet;
	problems: string[];
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}

/**
 * Walk one set's tree. Any folder holding a document.md is a document and its
 * subtree stops there — everything below it is that document's rule folders.
 * The marker is matched by name alone, so a folder that got the name wrong is
 * reported as an unreadable document rather than silently walked past.
 * Folders with no marker file (a pack's own `common/` helpers, grouping
 * folders) are simply passed through.
 */
const walk = async ({ folderPath, documentPath, set, problems, documents, rules }: WalkParams) => {
	const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => undefined);

	if (entries === undefined) {
		return;
	}

	if (entries.some((entry) => entry.name === 'document.md')) {
		const parsed = await parseDocumentFolder({ folderPath, documentPath, set, problems });

		if (parsed !== undefined) {
			documents.push(parsed.document);
			rules.push(...parsed.rules);
		}
	} else {
		const directories = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();

		for (const name of directories) {
			await walk({ folderPath: join(folderPath, name), documentPath: `${documentPath}/${name}`, set, problems, documents, rules });
		}
	}
};

/** Pack-wide id collisions — two folders claiming one rule id would make config overrides and site keys ambiguous. */
const findDuplicateIds = ({ rules }: { rules: LoadedStandardsRule[] }) => {
	const owners = new Map<string, string>();
	const duplicates: string[] = [];

	for (const rule of rules) {
		const owner = owners.get(rule.id);

		if (owner === undefined) {
			owners.set(rule.id, rule.documentPath);
		} else {
			duplicates.push(`duplicate rule id "${rule.id}": claimed by ${owner} and ${rule.documentPath}`);
		}
	}

	return duplicates;
};

/**
 * Read a standards pack off disk: its root file, its `code/` and `tests/`
 * document trees, and every rule folder under them.
 *
 * Load-time validation is structure and the honesty rule only — whether each
 * rule's declaration matches what its folder actually ships. Whether a check
 * catches what it claims is a different question, answered by
 * `lightsout standards-validate` against the rule's own fixtures.
 *
 * Every problem found across the whole walk is thrown together, so a pack
 * author fixes one list rather than replaying load-fix-load per fault.
 *
 * @param packPath - absolute pack root (the folder holding lightsout-standards.json)
 * @throws {Error} When the root file is missing or invalid, or the tree has any structural or honesty problem.
 */
export const readStandardsPack = async ({ packPath }: Params): Promise<LoadedStandardsPack> => {
	const rootFilePath = join(packPath, standardsPackRootFile);
	const rootText = await readFile(rootFilePath, 'utf8').catch(() => undefined);

	if (rootText === undefined) {
		throw new Error(`standards pack root file not found: ${rootFilePath}`);
	}

	let rootData: unknown;

	try {
		rootData = JSON.parse(rootText);
	} catch (error) {
		throw new Error(`standards pack root file is not valid JSON (${rootFilePath}): ${messageOf({ error })}`);
	}

	const root = StandardsPackRoot.safeParse(rootData);

	if (!root.success) {
		throw new Error(`standards pack root file is invalid (${rootFilePath}): ${formatSchemaIssues({ issues: root.error.issues, subject: 'root file' })}`);
	}

	const problems: string[] = [];
	const documents: LoadedStandardsDocument[] = [];
	const rules: LoadedStandardsRule[] = [];

	for (const set of [StandardsSet.Code, StandardsSet.Tests]) {
		await walk({ folderPath: join(packPath, set), documentPath: set, set, problems, documents, rules });
	}

	if (documents.length === 0) {
		problems.push('pack declares no documents — code/ and tests/ hold no folder with a document.md');
	}

	problems.push(...findDuplicateIds({ rules }));

	if (problems.length > 0) {
		throw new Error(`standards pack failed to load (${packPath}):\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
	}

	return {
		name: root.data.name,
		formatVersion: root.data.formatVersion,
		built: root.data.built,
		rootPath: packPath,
		documents,
		rules,
	};
};
