# Architecture Decision Record: UX Patterns & Mobile-First Interactions

## Context
As the application scales, the interaction patterns need standardization to ensure a consistent, mobile-optimized experience across forms, navigation, and feedback. Disparate UI approaches (e.g., modals vs. pages, varying input sizes) cause friction.

## Decision
1. **Universal Bottom Drawer Strategy:** Operational tasks (adding/editing expenses, settlements, group management) heavily leverage `Drawer` (Vaul) components sliding from bottom up instead of standard center dialogs or separate pages. This provides a better mobile ergonomics while keeping context.
2. **Sticky Action Footers:** Form actions (Save/Cancel) are removed from the scrollable document flow and placed in a fixed container (`position: fixed; bottom: 0; p-24`) to always be accessible regardless of form length.
3. **Mobile-Safe Sizing:** Global inputs are strictly set to 16px to prevent iOS Safari auto-zooming. Touch targets (buttons, list item rows) enforce a minimum 44px height.
4. **Contextual Primary CTAs:** Dashboard verbs adapt explicitly based on user state (e.g., "Pay Debt" vs. "Request Settlement" instead of a generic "Settle Up") and are promoted to full-width solid buttons when action is required.
5. **Meatball Menus (Unified Secondary Actions):** We standardized secondary list item actions (Edit, Delete, Share) behind a single `MoreVertical` (Ellipsis) dropdown trigger globally (Groups, Expenses, Transfers) to reduce UI clutter.

## Consequences
- Forms feel less like document pages and more like application modals.
- Navigation history is preserved as users swipe down to dismiss instead of relying on browser back logic for forms.
