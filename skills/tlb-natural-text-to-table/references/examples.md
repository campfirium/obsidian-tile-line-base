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
## task: Write docs
owner: Maya
status: doing
due: Friday

## task: Fix sync bug
owner: Leon
status: todo
due:
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
## person: Alice
team: Design
focus: onboarding

## person: Ben
team: Engineering
focus: sync
```

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
