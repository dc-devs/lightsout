import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { StandardsPackageRoot, StandardsSet } from '#src/contracts/index.ts';
import { parseDocumentFolder } from '#src/standardsPackages/common/parsing/parseDocumentFolder.ts';
import type { LoadedStandardsDocument } from '#src/standardsPackages/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/common/types/LoadedStandardsPackage.ts';
import type { LoadedStandardsRule } from '#src/standardsPackages/common/types/LoadedStandardsRule.ts';
import { formatSchemaIssues } from '#src/standardsPackages/common/utils/formatSchemaIssues.ts';

interface Params {
	/** Absolute package root. */
	packagePath: string;
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
 * Folders with no marker file (a package's own `common/` helpers, grouping
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

/** Package-wide id collisions — two folders claiming one rule id would make config overrides and site keys ambiguous. */
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
 * Read a standards package off disk: its root file, its `code/` and `tests/`
 * document trees, and every rule folder under them.
 *
 * Load-time validation is structure and the honesty rule only — whether each
 * rule's declaration matches what its folder actually ships. Whether a check
 * catches what it claims is a different question, answered by
 * `lightsout standards-validate` against the rule's own fixtures.
 *
 * Every problem found across the whole walk is thrown together, so a package
 * author fixes one list rather than replaying load-fix-load per fault.
 *
 * @param packagePath - absolute package root (the folder holding lightsout-standards.json)
 * @throws {Error} When the root file is missing or invalid, or the tree has any structural or honesty problem.
 */
export const loadStandardsPackage = async ({ packagePath }: Params): Promise<LoadedStandardsPackage> => {
	const rootFilePath = join(packagePath, 'lightsout-standards.json');
	const rootText = await readFile(rootFilePath, 'utf8').catch(() => undefined);

	if (rootText === undefined) {
		throw new Error(`standards package root file not found: ${rootFilePath}`);
	}

	let rootData: unknown;

	try {
		rootData = JSON.parse(rootText);
	} catch (error) {
		throw new Error(`standards package root file is not valid JSON (${rootFilePath}): ${messageOf({ error })}`);
	}

	const root = StandardsPackageRoot.safeParse(rootData);

	if (!root.success) {
		throw new Error(`standards package root file is invalid (${rootFilePath}): ${formatSchemaIssues({ issues: root.error.issues, subject: 'root file' })}`);
	}

	const problems: string[] = [];
	const documents: LoadedStandardsDocument[] = [];
	const rules: LoadedStandardsRule[] = [];

	for (const set of [StandardsSet.Code, StandardsSet.Tests]) {
		await walk({ folderPath: join(packagePath, set), documentPath: set, set, problems, documents, rules });
	}

	if (documents.length === 0) {
		problems.push('package declares no documents — code/ and tests/ hold no folder with a document.md');
	}

	problems.push(...findDuplicateIds({ rules }));

	if (problems.length > 0) {
		throw new Error(`standards package failed to load (${packagePath}):\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
	}

	return {
		name: root.data.name,
		formatVersion: root.data.formatVersion,
		built: root.data.built,
		rootPath: packagePath,
		documents,
		rules,
	};
};
