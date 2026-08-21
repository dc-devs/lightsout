import { SyncEventKind } from '../common/constants/SyncEventKind';
import type { SyncEvent } from '../common/types/SyncEvent';

export const routeSyncEvent = ({ event }: { event: SyncEvent }): string => {
	// one site references the object...
	if (event.kind === SyncEventKind.FileAdded) {
		return event.path;
	}

	// ...and the one below retypes the literal, which is how a rename of the
	// family's strings gets missed
	switch (event.kind) {
		case 'record-parsed': {
			return event.recordId;
		}
		default: {
			return '';
		}
	}
};
