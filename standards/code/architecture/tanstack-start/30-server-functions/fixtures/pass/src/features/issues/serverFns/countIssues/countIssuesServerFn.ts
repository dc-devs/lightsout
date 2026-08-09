import { createServerFn } from '@tanstack/react-start';
import { CountIssuesDocument } from './CountIssuesDocument';

export const countIssuesServerFn = createServerFn().handler(async () => CountIssuesDocument.length);
