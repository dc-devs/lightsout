import { getIssueRows } from './issuesUtils';

// The feature is a flat pile: no `screens/`, no `queries/`, no barrel, and a
// file named for the role of what it holds.
export const IssuesScreen = () => <ul>{getIssueRows().map((row) => <li key={row}>{row}</li>)}</ul>;
