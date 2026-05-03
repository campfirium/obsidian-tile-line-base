---
name: tlb-natural-text-to-table
description: Convert structured natural-language notes, bullet lists, meeting logs, outlines, and semi-structured Markdown into clean TileLineBase table Markdown. Use when the user asks to turn natural text into TLB, convert prose or bullets into table blocks, restructure notes into TileLineBase rows, or extract repeated records into H2 key-value rows.
---

# TLB Natural Text To Table

Use this skill when the input is not yet a TileLineBase table, but it already contains repeated, recognizable records such as tasks, people, events, inventory items, requirements, or status updates.

## Completion standard

The task is complete only when all of these are true:

- The output is valid TileLineBase row content built from repeated `## field: value` blocks.
- The first field name is consistent across every row. For hierarchical output, use one shared primary field such as `entry`.
- Skill-added field names are written in English. Values extracted from the source keep the source language.
- Parent-child output uses `TLBparent:` on child rows only. This helper field is for the Conversion Assistant and should not be treated as a visible business field.
- Default output uses a minimal schema: `entry`, optional `description`, and optional `TLBparent`.
- Do not introduce extra fields unless the user explicitly asks for them.
- Values come from the source text; weak guesses are avoided.
- Noise, commentary, and one-off prose are either omitted or called out before conversion.
- If the source mixes multiple record shapes that should not share one table, split them or stop and ask.

## Required output shape

TileLineBase row data uses one H2 block per row:

```md
## entry: Write launch post
description: Needs final screenshot
```

Rules:

- The first line of each row must start with `## `.
- The first field should be one shared primary label for every row. Prefer a general English field such as `entry` unless the user explicitly asks for another stable field name.
- Follow with flat `field: value` lines.
- If the source contains parent-child structure, keep the same primary field on both parent and child rows, and add `TLBparent: <parent primary value>` on child rows only.
- By default, only use these skill-added field names: `entry`, `description`, `TLBparent`.
- Do not translate extracted values. Preserve the source language in row titles and field values.
- Keep one field name spelling across all rows.
- Use an empty value only when the field is truly missing and a shared schema matters.
- Do not add free text between rows.

Read [references/examples.md](references/examples.md) only when you need concrete patterns.

## Workflow

1. Identify the row unit.
   Treat each repeated item as one row. Good units are one bullet block, one agenda item, one person card, one changelog item, or one repeated paragraph pattern.

   If the source is hierarchical, still treat each parent or child item as one row. Do not switch the primary field name between parent and child rows.

2. Pick the primary field.
   Choose the field that best names the row. Usually this is the subject users scan first.

3. Draft a shared field set.
   Keep it very small and stable. Default to `entry` plus `description`. If hierarchy exists, add `TLBparent` for child rows only.

4. Extract facts conservatively.
   Preserve source wording when it carries meaning. Normalize only light formatting such as extra spaces, checkbox markers, and duplicate punctuation.

   Preserve the original language of extracted values. Only the structural field names introduced by the skill should be normalized to English.

5. Fill missing values carefully.
   If a value is absent, leave it empty instead of inventing one. If many rows are missing the same field, drop that field unless the user clearly needs it.

6. Emit clean TLB blocks.
   Output only the final Markdown unless the user asked for explanation or review.

## Hierarchy contract

When the user wants parent-child rows for the Conversion Assistant:

- Use one shared primary field name across all rows, typically `entry`.
- Parent rows do not include `TLBparent`.
- Child rows must include `TLBparent: <parent primary value>`.
- `TLBparent` must exactly match the parent row's primary value.
- Keep the rest of the payload minimal. Put supporting text into `description` unless the user explicitly asks for more structure.
- Current design target is two levels only. Do not emit grandchild chains unless the user explicitly requests a lossy flattening strategy.
- If multiple parents would have the same title and create ambiguity, prefer renaming or clarifying the parent values instead of guessing.

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
- Keep the original language of extracted values.
- Turn obvious booleans into plain values like `yes`, `no`, `done`, `todo` only when the source is unambiguous.
- If one row contains extra detail that still matters, put it into `description`.

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
