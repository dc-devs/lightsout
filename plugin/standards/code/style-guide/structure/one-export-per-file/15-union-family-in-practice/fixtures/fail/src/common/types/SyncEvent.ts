export interface FileAddedEvent {
	kind: 'file-added';
	path: string;
}

export type SyncEvent = FileAddedEvent;
