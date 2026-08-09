import { createServerFn } from '@tanstack/react-start';

export const countIssuesServerFn = createServerFn().handler(async () => 0);
