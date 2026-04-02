---
name: tlb-natural-text-to-table
description: Convert structured natural-language notes, bullet lists, meeting logs, outlines, and semi-structured Markdown into clean TileLineBase table Markdown. Use when the user asks to turn natural text into TLB, convert prose or bullets into table blocks, restructure notes into TileLineBase rows, or extract repeated records into H2 key-value rows.
---

# TLB Natural Text To Table

Use this skill when the input is not yet a TileLineBase table, but it already contains repeated, recognizable records such as tasks, people, events, inventory items, requirements, or status updates.

## Completion standard

The task is complete only when all of these are true:

- The output is valid TileLineBase row content built from repeated `## field: value` blocks.
- Each row follows the same field set and field order.
- Values come from the source text; weak guesses are avoided.
- Noise, commentary, and one-off prose are either omitted or called out before conversion.
- If the source mixes multiple record shapes that should not share one table, split them or stop and ask.

## Required output shape

TileLineBase row data uses one H2 block per row:

```md
## task: Write launch post
status: in progress
owner: Maya
due: 2026-04-05
notes: Needs final screenshot
```

Rules:

- The first line of each row must start with `## `.
- The first field should be the primary label for the row, such as `task`, `person`, `project`, `bug`, `book`, or `event`.
- Follow with flat `field: value` lines.
- Keep one field name spelling across all rows.
- Use an empty value only when the field is truly missing and a shared schema matters.
- Do not add free text between rows.

Read [references/examples.md](references/examples.md) only when you need concrete patterns.

## Workflow

1. Identify the row unit.
   Treat each repeated item as one row. Good units are one bullet block, one agenda item, one person card, one changelog item, or one repeated paragraph pattern.

2. Pick the primary field.
   Choose the field that best names the row. Usually this is the subject users scan first.

3. Draft a shared field set.
   Keep it small and stable. Prefer 3 to 8 fields. Merge obvious synonyms such as `assignee` and `owner`, but do not merge fields with meaning drift.

4. Extract facts conservatively.
   Preserve source wording when it carries meaning. Normalize only light formatting such as extra spaces, checkbox markers, and duplicate punctuation.

5. Fill missing values carefully.
   If a value is absent, leave it empty instead of inventing one. If many rows are missing the same field, drop that field unless the user clearly needs it.

6. Emit clean TLB blocks.
   Output only the final Markdown unless the user asked for explanation or review.

## Heuristics

### Good candidates

- Repeated bullets with the same sub-items
- Meeting notes where each person or topic has the same attributes
- Release notes with item name, type, owner, date, status
- Reading lists, CRM notes, hiring pipelines, bug summaries

### Bad candidates

- One long essay with no repeated units
- Brainstorm fragments with no stable fields
- Mixed content where some sections are tasks, others are decisions, others are raw quotes

For bad candidates, either:

- propose a smaller slice that can be converted, or
- ask the user to choose the row unit

## Normalization rules

- Strip list markers like `- [ ]`, `-`, `*`, or numbering when they are only formatting.
- Keep dates in the source form unless the user asked for normalization.
- Keep casing for names and titles.
- Turn obvious booleans into plain values like `yes`, `no`, `done`, `todo` only when the source is unambiguous.
- If one row contains extra detail that does not fit the shared schema, put it into `notes`.

## Field design guardrails

- Prefer concrete field names over generic names like `field1`.
- Do not create separate fields for near-duplicates like `status`, `state`, and `progress`; pick one.
- Do not overfit one unusual row.
- If the text clearly represents more than one table, split by entity type.

## Ambiguity policy

Stop and ask only when one of these would materially change the result:

- More than one plausible row unit exists
- More than one plausible primary field exists
- The source contains multiple incompatible schemas
- Important values require interpretation rather than extraction

Otherwise, make the most conservative reasonable choice and proceed.

## Response pattern

When the user asks for conversion, default to:

1. one short sentence naming the row unit if needed
2. the TLB Markdown block output

If the user says “just convert it”, return only the Markdown.
