# Examples

## Bullet Tasks -> TLB

Source:

```md
- Write docs
  - owner: Maya
  - status: doing
  - due: Friday
- Fix sync bug
  - owner: Leon
  - status: todo
```

Output:

```md
## entry: Write docs
description: owner: Maya; status: doing; due: Friday

## entry: Fix sync bug
description: owner: Leon; status: todo
```

## People Notes -> TLB

Source:

```md
Alice
- Team: Design
- Focus: onboarding

Ben
- Team: Engineering
- Focus: sync
```

Output:

```md
## entry: Alice
description: Team: Design; Focus: onboarding

## entry: Ben
description: Team: Engineering; Focus: sync
```

## Parent Child Blocks For Conversion Assistant

Source:

```md
- 装修厨房
  - 选瓷砖
  - 联系师傅
```

Output:

```md
## entry: 装修厨房

## entry: 选瓷砖
TLBparent: 装修厨房
description:

## entry: 联系师傅
TLBparent: 装修厨房
description:
```

Rule:

- Field names added by the skill stay in English.
- Extracted values stay in the source language.
- Parent and child rows share the same primary field name.

## Mixed Content -> Split Or Ask

Source:

```md
## Decisions
- Raise price in May

## Tasks
- Update landing page
- Email customers
```

Action:

- Do not force one table.
- Either convert only one section or ask whether the user wants a decisions table or a tasks table.
