interface Params {
	bytes: number;
}

/**
 * A file size a reader can judge at a glance — '812 B', '4.2 KB', '1.3 MB'.
 *
 * The plan tab names a transcript and its size instead of rendering it, and the
 * size is the whole reason: 700 KB of agent turns is a file somebody opens
 * elsewhere, and the number is what says so.
 */
export const formatBytes = ({ bytes }: Params): string => {
	const kilobyte = 1024;
	let formatted = `${bytes} B`;

	if (bytes >= kilobyte * kilobyte) {
		formatted = `${(bytes / (kilobyte * kilobyte)).toFixed(1)} MB`;
	} else if (bytes >= kilobyte) {
		formatted = `${(bytes / kilobyte).toFixed(1)} KB`;
	}

	return formatted;
};
