import { createFileRoute } from '@tanstack/react-router';
import { Home, homeMeta } from '#src/features/home/index.ts';

export const Route = createFileRoute('/')({
	// No loader. Home suspends on nothing, and the one query it does read — the
	// default pack's three numbers — is deliberately left cold: a build on a slow
	// disk has to paint the headline immediately, and the section stands without
	// them.
	head: () => ({ meta: homeMeta }),
	component: Home,
});
