# ADR 0011: Shared UI foundation

- Status: accepted for phase 1
- Date: 2026-10-15

## Context

Later race views need one visual base: light and dark color, type, spacing, and a small set of controls. Volunteers use the app in sunlight and in a dark finish tent, with a keyboard or a finger, in Finnish or English. Apple's Human Interface Guidelines set the touch target at 44 pt and expect the interface to follow the system appearance. WCAG 2.2 AA sets the contrast and keyboard bar.

## Decision

Design tokens are CSS variables on `:root`. `[data-theme="dark"]` overrides them. The stored choice is `system`, `light` or `dark`. `system` is the default and follows `prefers-color-scheme`, including changes while the app is open. Light and dark override the system until the user picks System again.

The dark primary fill is `#0a70d0` with white text (about 4.95:1). The lighter system blue `#0a84ff` with white text is about 3.65:1, which misses WCAG 2.2 AA for normal text. Light mode keeps `#0a4fad` with white text. Body text, secondary text, links, focus rings, field borders, banners and status badges each have a light and a dark pair that clears 4.5:1 for text and 3:1 for control boundaries.

Shared components are `Button` (primary, secondary, danger), `TextField`, `DateField`, `Select`, `Checkbox`, `TextLink`, `Banner`, `ListRow`, `StatusBadge`, `Clock` and `HintFrame`. Interactive targets are at least 44 by 44 px (`--target`), including an inline `TextLink` and a `Checkbox` whose box and label are both at least that size. Text uses the system font at 17 px. Spacing follows an 8 px grid.

`DateField` edits a calendar date in the app locale. It is a text field, not `<input type="date">`, so an English browser does not switch a Finnish race to month/day/year. Finnish shows `12.6.2027`. English shows the `formatDate` value, `12/06/2027`. The stored value is `YYYY-MM-DD`. Finnish `formatDate` has no leading zero (`12.6.2027`, `5.6.2026`). English stays `12/06/2027`. The field follows that stored value when it changes from outside, unless the volunteer is mid-edit. A format hint is always visible. An unparseable value is an error after blur, using `TextField`'s hint and error text with `aria-invalid` and `aria-describedby`.

`TextLink` is an inline link. Its hit area is at least `--target`, with no horizontal padding, so the label stays in line with the surrounding text.

`HintFrame` is an inline region in the view. It shows a `<view>.hint.<id>` string only while guided mode is on. Guided is the default. The hint is not a dialog or a popover. Turning on expert mode removes the hint without reloading and without changing what the volunteer typed.

A dev build renders every component at `#/preview`. `import.meta.env.DEV` guards that route, and the production build does not include it. Strings for that page, including the hint, live in `packages/i18n/locales/fi.json` and `en.json`.

Race views keep their current markup until their own issues move them onto these components.

## Consequences

- New views import from `packages/web/src/ui` and add strings in both catalogs.
- A contrast change belongs in the tokens, not in a single view.
- In a dev build, `#/preview` is the page where axe must report no violations in both themes. The production bundle does not register that route.
