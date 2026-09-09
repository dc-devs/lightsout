import { readFileSync } from 'node:fs';
import { GateLock } from '#src/contracts/index.ts';

interface Params {
	/** Already resolved by `withGateLock`, so the git call that produced it is paid once per gate run. */
	lockPath: string;
}

/**
 * The current reservation, or undefined when absent or unparseable — the
 * acquirer treats what it cannot parse as a leftover.
 *
 * Read synchronously, unlike `readRunLock`, for two reasons. It is polled every
 * two seconds for up to half an hour, and one small JSON file read costs less
 * than the threadpool round trip it would otherwise queue. More importantly it
 * is the read half of a check-then-act on a lock: keeping it on the calling
 * turn means nothing else in this process can interleave between reading a
 * holder and acting on what it said.
 */
export const readGateLock = ({ lockPath }: Params): GateLock | undefined => {
	let raw: string;

	try {
		raw = readFileSync(lockPath, 'utf8');
	} catch {
		return undefined;
	}

	try {
		return GateLock.parse(JSON.parse(raw));
	} catch {
		return undefined;
	}
};
