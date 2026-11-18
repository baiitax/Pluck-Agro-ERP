# Design system

## 1. Principles

Professional, information-dense, fast. No decorative gradients, no invented metrics, no
placeholder buttons. Density is tuned for people who use the ERP for hours a day, with
generous enough spacing on mobile.

## 2. Tokens

Defined in `app/globals.css` via Tailwind v4 `@theme`:

| Token group | Values |
|---|---|
| Brand | `--color-brand-50 … 950` — deep forest green (`brand-700` = primary actions) |
| Surfaces | `surface` (#fff), `surface-muted` (#f6f7f5), `surface-sunken` (#eef0ec) |
| Text | `ink`, `ink-muted`, `ink-subtle` |
| Borders | `border`, `border-strong` |
| Semantic | `success`, `pending`, `warning`, `danger`, `info`, `neutral` (each with 50/600/700) |
| Shape | `--radius-card: 0.75rem`, `--shadow-card` |
| Type | system sans stack, no webfont download (fast first paint) |

Components consume semantic tokens (`bg-surface`, `text-ink-muted`, `border-border`), so a dark
theme only requires re-declaring variables.

## 3. Status is never colour-only

`Badge` renders a dot plus a text label (`Active`, `Suspended`, `Planned`, `Revoked`). Status
badges always include words.

## 4. Components

```text
components/ui/          button, input (+Textarea, Select, Label, FieldError, FieldHint),
                        badge, card, table, dialog, skeleton, alert
components/layout/      app-shell, app-sidebar, app-header, mobile-nav, user-menu, brand-mark
components/shared/      page-header, breadcrumbs, metric-card, status-badge, empty-state,
                        error-state, permission-guard, pagination, filter-bar, module-placeholder
components/tables/      data-table (TanStack), permissions-table
components/forms/       login, forgot-password, reset-password, employee-form, use-server-form
components/users/       access-controls (assign/revoke role, account status)
```

## 5. Layout

- **Desktop ≥768px** — persistent 264px sidebar (collapsible to 68px with icon tooltips),
  sticky header, `max-w-[92rem]` content, footer with version/phase.
- **Tablet** — collapsible sidebar, adaptive 2-column grids, horizontally scrollable tables.
- **Mobile** — drawer navigation, single column, 44px touch targets, tables scroll inside
  their own container so page chrome never shifts.

## 6. Accessibility

- Skip-link to `#main-content`.
- Visible focus rings (`outline: 2px solid brand-600`, offset 2px).
- `aria-current="page"` on the active nav item, `aria-expanded` on toggles, `aria-haspopup`
  on the user menu, `aria-modal`/`aria-labelledby` on dialogs, `aria-busy` on skeletons.
- Labels are always associated with inputs; errors use `role="alert"`.
- Reduced-motion media query disables transitions.
- Colour contrast: ink on surface ≥ 12:1; muted text ≥ 4.5:1.

## 7. Honest UI states

Unimplemented modules render `ModulePlaceholder` with a "Not implemented" badge, the planned
phase, the required permission and the planned scope. The header shows a **disabled** global
search marked "available in a later phase" rather than a fake input, and the notification bell
links to a page that explains notifications are not enabled yet.
