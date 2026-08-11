export interface FileAddedEvent {
	kind: 'file-added';
	path: string;
}

export interface RecordParsedEvent {
	kind: 'record-parsed';
	recordId: string;
}

export type SyncEvent = FileAddedEvent | RecordParsedEvent;
