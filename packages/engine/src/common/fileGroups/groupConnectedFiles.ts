interface Params {
	files: string[];
	/** Edges among `files`; pairs touching anything outside the set are ignored. */
	edges: Array<{ from: string; to: string }>;
}

/**
 * Connected components of the changed-file import graph — each component is
 * one test-writing job (a boundary plus the internals it reaches, by
 * construction). Deterministic: members sorted within a component,
 * components ordered by their first member, independent of edge order.
 */
export const groupConnectedFiles = ({ files, edges }: Params): string[][] => {
	const parent = new Map<string, string>(files.map((file) => [file, file]));

	const find = (file: string): string => {
		const up = parent.get(file);

		if (up === undefined || up === file) {
			return file;
		}

		const root = find(up);

		parent.set(file, root);

		return root;
	};

	for (const { from, to } of edges) {
		if (!parent.has(from) || !parent.has(to)) {
			continue;
		}

		const rootFrom = find(from);
		const rootTo = find(to);

		if (rootFrom !== rootTo) {
			parent.set(rootFrom, rootTo);
		}
	}

	const byRoot = new Map<string, string[]>();

	for (const file of files) {
		const root = find(file);

		byRoot.set(root, [...(byRoot.get(root) ?? []), file]);
	}

	return [...byRoot.values()].map((group) => [...group].sort()).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
};
