import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { listCommandsServerFn } from '#src/features/commands/serverFns/listCommandsServerFn.ts';

/**
 * The whole command catalog in one query rather than one query per command.
 *
 * It is a few kilobytes of static data that changes only when the engine does,
 * so the detail page needs no second round trip and nothing here is polled.
 */
export const commandsQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.Commands],
		queryFn: () => listCommandsServerFn(),
	});
