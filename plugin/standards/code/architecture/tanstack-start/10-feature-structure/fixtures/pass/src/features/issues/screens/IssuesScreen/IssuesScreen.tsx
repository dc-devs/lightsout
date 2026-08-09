import { getIssueRows } from '../../common/utils/getIssueRows';

export const IssuesScreen = () => <ul>{getIssueRows().map((row) => <li key={row}>{row}</li>)}</ul>;
