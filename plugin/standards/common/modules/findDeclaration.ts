import { isBarrelFile } from '../paths/isBarrelFile.ts';
import type { ModuleLink } from '../types/ModuleLink.ts';

interface Params {
	/** The name as the target knows it — the `from` side of the entry that points there. */
	name: string;
	/** The file the entry points at, which may itself be a barrel. */
	target?: string;
	/** Every module link the run could read, keyed by the file that wrote it. */
	links: Map<string, ModuleLink[]>;
}

const follow = ({ name, target, links, seen }: Params & { seen: Set<string> }): { file: string; name: string } | undefined => {
	if (target === undefined || !isBarrelFile({ path: target }) || seen.has(target)) {
		return target === undefined ? undefined : { file: target, name };
	}

	seen.add(target);

	const next = (links.get(target) ?? []).filter((link) => link.reExport).find((link) => link.names.some((entry) => entry.as === name));

	return next === undefined
		? { file: target, name }
		: follow({ name: next.names.find((entry) => entry.as === name)?.from ?? name, target: next.target, links, seen });
};

/**
 * The file that actually declares a published name, and the name that file
 * exports it under.
 *
 * A name is often published through a chain — `runState/index.ts` publishes
 * `acquireRunLock` from `runState/lock/index.ts`, which publishes it from
 * `runState/lock/acquireRunLock.ts` — so the file behind an entry is found by
 * following the name, hop by hop, until the target stops being a barrel. The
 * name can be renamed on the way (`export { a as b }`), which is why each hop
 * looks the next one up by the name the barrel published it AS and carries on
 * with the name the target knows it by. A chain that loops, or a barrel that
 * does not publish the name, ends at the barrel it reached.
 */
export const findDeclaration = ({ name, target, links }: Params): { file: string; name: string } | undefined =>
	follow({ name, target, links, seen: new Set() });
