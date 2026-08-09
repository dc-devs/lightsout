import { createServerFn } from '@tanstack/react-start';
import { CountIssuesDocument } from './CountIssuesDocument';

// camelCase folder, PascalCase document, camelCase function — the casing tells
// you what each file is before you open it.
export const countIssuesServerFn = createServerFn().handler(async () => CountIssuesDocument.length);
