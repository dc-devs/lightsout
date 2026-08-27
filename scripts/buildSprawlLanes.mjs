/**
 * How many of a lane's files sit over the cap for their dialect.
 *
 * This is the number the payoff counter reports, so it is measured on the
 * lane's whole tree rather than on the bars the chart happens to draw.
 */
const countOverCap = ({ files, caps }) => {
	let over = 0;

	for (const [path, lines] of files) {
		if (lines > (path.endsWith('.tsx') ? caps.tsxFile : caps.file)) {
			over += 1;
		}
	}

	return over;
};

/** Every folder holding a TypeScript file at this frame, and every folder above it. */
const buildFolderSet = ({ files }) => {
	const folders = new Set();

	for (const path of files.keys()) {
		for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
			folders.add(path.slice(0, cut));
		}
	}

	return folders;
};

/**
 * The graduations that happened between two frames.
 *
 * A graduation is a file leaving and a folder of its own name arriving with an
 * `index.ts` inside it, in the same commit. The folder has to be NEW — an
 * ordinary deletion beside a same-stem folder that was already there is a
 * deletion, and calling it a split would invent a move nobody made.
 */
const findGraduations = ({ previous, current, previousFolders, currentFolders }) => {
	const graduations = [];

	for (const path of previous.files.keys()) {
		const stem = path.replace(/\.tsx?$/, '');
		const prefix = `${stem}/`;
		const hasIndex = current.files.has(`${prefix}index.ts`) || current.files.has(`${prefix}index.tsx`);

		if (!current.files.has(path) && hasIndex && !previousFolders.has(stem) && currentFolders.has(stem)) {
			graduations.push([path, prefix]);
		}
	}

	return graduations;
};

/**
 * One frame of the counterfactual: the same tree with every active graduation
 * summed back into the file it came out of.
 *
 * Substitutions are applied longest prefix first, so a split inside an
 * already-undone folder lands in the outer sum instead of being counted twice.
 * The folder the split created — and everything beneath it — leaves the folder
 * rows, and the folder the file came out of gets its file back, because in this
 * history it never left.
 */
const undoGraduations = ({ tree, substitutions }) => {
	const files = new Map(tree.files);
	const folders = new Map(tree.folders);
	const ordered = [...substitutions].sort(([, left], [, right]) => right.length - left.length);

	for (const [path, prefix] of ordered) {
		let lines = 0;

		for (const [candidate, count] of files) {
			if (candidate.startsWith(prefix)) {
				lines += count;
				files.delete(candidate);
			}
		}

		files.set(path, lines);

		for (const folder of folders.keys()) {
			if (folder === prefix.slice(0, -1) || folder.startsWith(prefix)) {
				folders.delete(folder);
			}
		}

		const parent = path.slice(0, path.lastIndexOf('/'));

		folders.set(parent, (folders.get(parent) ?? 0) + 1);
	}

	return { files, folders };
};

/**
 * Both lanes' full state at every frame.
 *
 * The two lanes are the same commits and differ by exactly one variable: in the
 * "without" lane every graduation is undone, so the file that split keeps
 * growing at its original path. That is the whole claim the hero makes, and
 * replaying the real history is the only way to make it without inventing data.
 *
 * Consolidation is deliberately not undone. A folder's population is counted as
 * the census check counts it — direct files only — so moving a folder under a
 * new parent changes no number this chart draws, and undoing it would be
 * invisible. The caption says "every split undone", which is exactly what this
 * lane is.
 *
 * @param trees - each frame's measured tree, from `readSprawlTrees`
 * @param caps - the standards pack's caps, from `readSprawlCaps`
 */
export const buildSprawlLanes = ({ trees, caps }) => {
	const withStates = [];
	const withoutStates = [];
	const substitutions = new Map();
	let previous = { files: new Map(), folders: new Map() };
	let previousFolders = new Set();

	for (const tree of trees) {
		const currentFolders = buildFolderSet({ files: tree.files });

		for (const [path, prefix] of findGraduations({ previous, current: tree, previousFolders, currentFolders })) {
			substitutions.set(path, prefix);
		}

		for (const [path, prefix] of substitutions) {
			// The folder this file was summing has gone: a deleted subtree is a
			// deletion in both lanes, not a zero-line phantom held at a path nobody
			// has any more.
			if (!currentFolders.has(prefix.slice(0, -1))) {
				substitutions.delete(path);
			}
		}

		const without = undoGraduations({ tree, substitutions });

		withStates.push({ files: tree.files, folders: tree.folders, overCap: countOverCap({ files: tree.files, caps }) });
		withoutStates.push({ files: without.files, folders: without.folders, overCap: countOverCap({ files: without.files, caps }) });
		previous = tree;
		previousFolders = currentFolders;
	}

	return { withStates, withoutStates };
};
