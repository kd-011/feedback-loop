# Design

Device: desktop-first. Tier: desktop-tool.

## Direction

A single-column status page on the machine that runs it: the job list is the whole screen, one card per job, newest first. Dark, quiet, system font, small type (11 to 14 px), colour only for job status. Capped at 640 px wide, with tighter padding under 480 px. All styles are inline in `server.mjs` (`STATUS_HTML`).

## Identity

The coloured left border and matching badge on each job card: grey pending, indigo running, green completed, red failed, repeated as dots in the counts row.

## System

Tokens: none, hex values inline in the `<style>` block of `STATUS_HTML` in `server.mjs`. Kit: none. Icons: none. Font: `system-ui`.

## Refuses

- No chat UI and no PWA: the reporting app owns the conversation.
- No controls: the page only shows jobs, it never creates, retries or cancels them.

## Surfaces

- Status (`/`, refreshed from `/api/jobs`): operating. Shows counts and the last 30 jobs with title, repo, kind, source, age, description, error, session id and an expandable result. States: empty ("No jobs yet."), pending, running, completed, failed.
