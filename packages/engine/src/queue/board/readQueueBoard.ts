import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { QueueBoard } from '#src/contracts/queue/QueueBoard.ts';
import { getQueueBoardPath } from '#src/queue/board/getQueueBoardPath.ts';

interface Params {
	/** The MAIN repository checkout the coordinator run lives in. */
	cwd: string;
	/** The coordinator run's id. */
	runId: string;
}

/**
 * The board a queue run last recorded, or undefined when it recorded none, the
 * file is unreadable, or its contents do not satisfy the contract.
 */
export const readQueueBoard = async ({ cwd, runId }: Params): Promise<QueueBoard | undefined> => {
	return readJsonFile({ path: await getQueueBoardPath({ cwd, runId }), schema: QueueBoard });
};
