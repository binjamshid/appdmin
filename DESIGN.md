# Appdmin interface system

## Direction

The interface is an information-rich operations console with Apple-like restraint. It uses quiet
neutral surfaces, compact typography, subtle borders, and one restrained accent. Hierarchy comes
from type, rhythm, alignment, and source-aware status, not decoration.

## Tokens

- Canvas: cool neutral `--bg`; content: `--surface`; secondary fields: `--surface-2`.
- Primary ink is near-black, with muted and faint tiers for metadata.
- Indigo is the default interactive accent. Green means a verified healthy state, amber means
  partial/delayed/stale, and red means failure or unavailability.
- Default panel radius is 16px; controls use 9–10px. Shadows are reserved for transient elevation.
- Spacing follows a compact 4/8/12/16/24/32 rhythm.

## Typography

Use the native system stack and its tabular/alternate glyph features. Page titles are compact and
tightly tracked. Eyebrows orient the owner; body copy remains concise. Operational tables use small
but readable labels with strong value/metadata separation.

## Components

- Desktop uses a 238px sidebar and sticky contextual header.
- Mobile uses a five-destination bottom bar, touch-sized controls, and structurally collapsed rows.
- Panels group a coherent question; metric cards are limited to a summary band.
- Every metric or row can carry a quality pill and source/freshness detail.
- Empty states name the missing capability and the corrective action.
- Dialogs are used for permission review, secret entry, and bounded edits.
- Toasts confirm short-lived outcomes; persistent failures remain in the page.

## Motion

Motion is limited to hover elevation, skeleton shimmer, dialog transitions supplied by the browser,
and small status changes. All custom animation respects reduced-motion preferences.

## Content

Use sentence case, direct verbs, and exact source language. Never call a missing value zero. Never
use “AI-powered” as decorative copy. Explain why a value is unavailable and what configuration can
resolve it.
