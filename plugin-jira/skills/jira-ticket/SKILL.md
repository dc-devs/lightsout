---
name: jira-ticket
description: >-
  Jira Cloud mechanics for the lightsout ticket workflow — route labels,
  statuses, attachments, branch linking, and pull-request conventions. Use
  alongside ticket-workflow when filing, shaping, or closing Jira work.
---

# Jira Cloud mechanics

Read `ticket-workflow` first. It owns what a ticket says, how it is shaped, and
how work moves from ticket to branch to pull request. This skill adds only Jira
Cloud mechanics.

## Queue conventions

Give an automated issue exactly one configured `route-*` label. The repository's
configured eligible and in-progress status names determine whether the queue may
work it. Never invent a workflow status, label, issue type, or custom field.

Use the Jira issue key in the branch, plan-folder, and pull-request conventions
defined by `ticket-workflow`. Jira links work by that key; the shared workflow
decides the exact branch and pull-request text.

## Authentication

Jira Cloud REST v3 uses Basic authentication with the account email as the user
and an API token as the password. Put both values in environment variables and
never print them, paste them into a command, or commit them:

```sh
export JIRA_ACCOUNT_EMAIL='you@example.com'
export JIRA_API_TOKEN='your-api-token'
export JIRA_SITE_URL='https://example.atlassian.net'
export JIRA_PROJECT='LO'
```

The examples below let `curl --user` construct the Basic header from those
variables. Do not use verbose curl output because it can expose request headers.

## Discover an issue type

List the project's createable issue types and select the intended non-subtask
type id. Do not guess the id:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  "${JIRA_SITE_URL:?}/rest/api/3/issue/createmeta/${JIRA_PROJECT:?}/issuetypes"
```

## Create an issue

Send the project key, selected issue-type id, summary, ADF description, and the
one configured route label. Retain the returned `key` and `id`:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{
    "fields": {
      "project": { "key": "LO" },
      "issuetype": { "id": "10001" },
      "summary": "Title",
      "description": { "type": "doc", "version": 1, "content": [] },
      "labels": ["route-direct"]
    }
  }' \
  "${JIRA_SITE_URL:?}/rest/api/3/issue"
```

## Update an issue

Update the issue through the same `fields` or `update` envelope. A successful
write returns HTTP 204 with no body:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data '{
    "fields": {
      "summary": "Updated title",
      "description": { "type": "doc", "version": 1, "content": [] }
    },
    "update": { "labels": [{ "add": "route-direct" }] }
  }' \
  "${JIRA_SITE_URL:?}/rest/api/3/issue/LO-123"
```

## Attach plan files

Attach every plan file required by `ticket-workflow`, one request per file. Jira
requires multipart field name `file` and the `X-Atlassian-Token: no-check`
header:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  --header 'X-Atlassian-Token: no-check' \
  --request POST \
  --form 'file=@.lightsout/plans/lo-123-feature/plan.md' \
  "${JIRA_SITE_URL:?}/rest/api/3/issue/LO-123/attachments"
```
