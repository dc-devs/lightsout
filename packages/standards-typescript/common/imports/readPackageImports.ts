import { getDirectory } from '../paths/getDirectory.ts';
import type { PathAliases } from '../types/PathAliases.ts';
import { isRecord } from '../utils/isRecord.ts';

/** The unconditional target of one `imports` entry: a string, a list, or the `default` branch of a conditional object. */
const readTargets = ({ target }: { target: unknown }): string[] | undefined => {
	if (typeof target === 'string') {
		return [target];
	}

	if (Array.isArray(target)) {
		return target.filter((entry): entry is string => typeof entry === 'string');
	}

	return isRecord(target) && 'default' in target ? readTargets({ target: target.default }) : undefined;
};

interface Params {
	/** Repo-relative path of the package.json this text came from — its folder anchors the targets. */
	manifestPath: string;
	/** The manifest's contents. */
	text: string;
}

/**
 * The path aliases one package manifest declares in its `imports` field, or
 * `undefined` when this file alone cannot answer.
 *
 * An empty `patterns` map is a real answer, the same way it is for a tsconfig:
 * a manifest with an empty `imports` block has stated that nothing is aliased.
 * `undefined` is reserved for a manifest that declares no `imports` at all, or
 * text that is not JSON. Neither says anything about the tsconfig sitting
 * beside it, so the caller must stay free to keep looking — answering "no
 * aliases" there would turn every aliased import in the package into a
 * confident "external", which is the mistake this distinction exists to
 * prevent.
 *
 * Read with `JSON.parse` rather than the comment-stripping machinery a tsconfig
 * needs: `package.json` is strict JSON, and every tool that resolves this field
 * parses it that way too.
 */
export const readPackageImports = ({ manifestPath, text }: Params): PathAliases | undefined => {
	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}

	const imports = isRecord(data) ? data.imports : undefined;

	if (!isRecord(imports)) {
		return undefined;
	}

	const patterns = new Map<string, string[]>();

	for (const [pattern, target] of Object.entries(imports)) {
		const targets = readTargets({ target });

		if (targets !== undefined) {
			patterns.set(pattern, targets);
		}
	}

	return { base: getDirectory({ path: manifestPath }), patterns };
};
