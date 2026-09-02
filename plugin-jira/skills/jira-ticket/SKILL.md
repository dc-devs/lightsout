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
and an API token as the password. The connection has one home: the top-level
`ticket-tracker` block in `lightsout.config.json`. For provider `jira`, read the
site from `site-url`, the project from `project`, and the two credential
environment-variable names from `api-key-env` and `api-user-email-env`.

Only the credential values belong in the environment. Never print them, paste
their values into a command, or commit them. These exports are examples for a
repository whose two config fields name `JIRA_ACCOUNT_EMAIL` and
`JIRA_API_TOKEN`; use the names the repository actually configures:

```sh
export JIRA_ACCOUNT_EMAIL='you@example.com'
export JIRA_API_TOKEN='your-api-token'
```

The examples below use `<jira-site-url>` and `<jira-project-key>` for the two
non-secret values read from config, and let `curl --user` construct the Basic
header from the example credential variables. Substitute the configured
credential variable names when they differ. Do not use verbose curl output
because it can expose request headers.

## Discover an issue type

List the project's createable issue types and select the intended non-subtask
type id. Do not guess the id:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  "<jira-site-url>/rest/api/3/issue/createmeta/<jira-project-key>/issuetypes"
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
      "project": { "key": "<jira-project-key>" },
      "issuetype": { "id": "10001" },
      "summary": "Title",
      "description": { "type": "doc", "version": 1, "content": [] },
      "labels": ["route-direct"]
    }
  }' \
  "<jira-site-url>/rest/api/3/issue"
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
  "<jira-site-url>/rest/api/3/issue/<jira-issue-key>"
```

## Attachments

The `ticket-workflow` skill is the one home for which files travel and for the
command that publishes a finished plan. Do not enumerate or upload that durable
set by hand; follow its ready-to-implement publish step.

When the shared workflow calls for a Jira attachment before a finished plan
exists, Jira requires multipart field name `file` and the
`X-Atlassian-Token: no-check` header:

```sh
curl --fail-with-body --silent --show-error \
  --user "${JIRA_ACCOUNT_EMAIL:?}:${JIRA_API_TOKEN:?}" \
  --header 'X-Atlassian-Token: no-check' \
  --request POST \
  --form 'file=@<path-required-by-ticket-workflow>' \
  "<jira-site-url>/rest/api/3/issue/<jira-issue-key>/attachments"
```
