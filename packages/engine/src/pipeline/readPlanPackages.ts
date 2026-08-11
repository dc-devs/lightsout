interface Params {
	planContent: string;
}

/**
 * Read the `packages:` list from a plan's YAML front-matter — the plan is
 * where scope knowledge lives, so `/implement plan.md` needs nothing else.
 * Deterministic and dependency-free: supports the inline form
 * (`packages: [a, b]`) and the block-list form (`- a` lines). Returns
 * undefined when there is no front-matter, no `packages:` key, or an empty
 * list — the caller decides whether missing scope is an error.
 */
export const readPlanPackages = ({ planContent }: Params) => {
	const frontMatter = planContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];

	if (!frontMatter) {
		return undefined;
	}

	const lines = frontMatter.split(/\r?\n/);
	const keyIndex = lines.findIndex((line) => /^packages:/.test(line.trim()));
	const keyLine = lines[keyIndex]?.trim();

	if (keyIndex === -1 || keyLine === undefined) {
		return undefined;
	}

	const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');
	const inline = keyLine.match(/^packages:\s*\[(.*)\]\s*$/);

	if (inline?.[1] !== undefined) {
		const items = inline[1].split(',').map(unquote).filter(Boolean);

		return items.length > 0 ? items : undefined;
	}

	const items: string[] = [];

	for (let index = keyIndex + 1; index < lines.length; index += 1) {
		const entry = lines[index]?.trim().match(/^-\s+(.+)$/);

		if (!entry?.[1]) {
			break;
		}

		items.push(unquote(entry[1]));
	}

	return items.length > 0 ? items : undefined;
};
