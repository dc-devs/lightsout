export interface JiraIssue {
	id: string;
	key: string;
	fields: JiraIssueFields;
}

interface JiraIssueFields {
	summary?: string;
	created?: string;
	labels?: string[] | null;
	status?: { statusCategory?: { key?: string } } | null;
	issuelinks?: JiraIssueLink[] | null;
	description?: unknown | null;
	priority?: { name?: string } | null;
}

interface JiraIssueLink {
	type?: { inward?: string } | null;
	inwardIssue?: {
		key?: string;
		fields?: { status?: { statusCategory?: { key?: string } } | null } | null;
	} | null;
}
