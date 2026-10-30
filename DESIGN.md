---
name: OmniBank Local
description: Le contrôle d'un tableur, le confort d'une app moderne, l'intelligence d'un LLM.
colors:
  accent-profile: "#6366f1"
  accent-profile-hover: "#4f46e5"
  ink-night: "#161c24"
  slate-surface: "#212b36"
  ledger-input: "#1c2430"
  rule-line: "#333d48"
  paper-white: "#f9fafb"
  muted-graphite: "#919eab"
  titanium-base: "#1c2026"
  titanium-surface: "#232832"
  titanium-accent: "#60a5fa"
  income-green: "#36b37e"
  expense-red: "#ff5630"
  variable-expense-coral: "#ff8a65"
  transfer-cyan: "#00b8d9"
  warning-amber: "#ffab00"
typography:
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.04em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-profile}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-profile-hover}"
  button-secondary:
    backgroundColor: "rgba(145, 158, 171, 0.08)"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.ledger-input}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.slate-surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  chip-category:
    backgroundColor: "{colors.ledger-input}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
---

# Design System: OmniBank Local

## Overview

**Creative North Star: "Le Registre du Trésorier"**

OmniBank is a modern account book. Its job is to make figures trustworthy at a glance: columns align, amounts read in tabular digits, and every colour carries meaning (which account, which direction of money, which state) before it carries mood. The interface is calm and precise rather than flashy; the satisfaction comes from a ledger that balances, not from decoration.

It serves two equal contexts: a dense workspace on PC, where a treasurer reconciles and analyses for long sessions, and a fast one-handed phone, where an entry or a check takes seconds. Density is welcome on PC as long as type stays legible; on phone, the same data is reorganised, never just shrunk.

The system ships four themes that must stay in step: Classique sombre (default) and Classique clair, Titanium sombre and Albâtre clair. Classique sombre and Titanium sombre are the two reference themes; every change is checked in both, plus one light theme. The interface accent is not fixed: it is the colour the user picks for their profile, so no design may depend on a specific accent hue.

**Key Characteristics:**
- Figures first: amounts in tabular numerals, right-aligned in tables, one hero figure per card.
- Colour is semantic: per-account colours, income green, expense red, transfer cyan; the profile accent marks the user's own actions and the current location.
- One line-icon set (stroke icons inheriting `currentColor`), no emoji in interface chrome.
- Tonal layering over shadows; thin rules separate ledger rows.
- Same structure in all four themes; only the tokens change.

## Colors

A night-slate ledger with one user-chosen accent and a strict set of money-meaning colours.

### Primary
- **Profile Accent** (`accent-profile`, default indigo): the colour chosen in the active profile's settings, applied at runtime over every theme. Used for the primary action of a screen, the active navigation item, focus rings, selection and toggles. Its hover is a deeper step of the same hue.

### Secondary
- **Account Colours** (per account, user-defined): each account keeps its colour everywhere it appears: sidebar balance, filter chip, card edge, chart series. They identify, they do not decorate.

### Tertiary (money semantics)
- **Income Green** (`income-green`): incoming money, positive balances, completed reconciliation.
- **Expense Red** (`expense-red`): fixed expenses and destructive actions.
- **Variable-Expense Coral** (`variable-expense-coral`): variable spending.
- **Transfer Cyan** (`transfer-cyan`): movements between the user's own accounts.
- **Warning Amber** (`warning-amber`): items to verify, unreconciled before payday.

### Neutral
- **Ink Night** (`ink-night`): Classique sombre page background.
- **Slate Surface** (`slate-surface`): cards, panels, table body.
- **Ledger Input** (`ledger-input`): fields and category chips, a step below the surface.
- **Rule Line** (`rule-line`): borders and row dividers.
- **Paper White** (`paper-white`): primary text on dark.
- **Muted Graphite** (`muted-graphite`): secondary text, column headers, reconciled rows.
- **Titanium Base / Surface** (`titanium-base`, `titanium-surface`) with **Titanium Accent** (`titanium-accent`): the Titanium sombre counterparts; Albâtre clair and Classique clair use warm and cool paper backgrounds respectively.

### Named Rules
**The Meaning-Before-Mood Rule.** A colour on a figure must answer "which account?" or "money in or out?". Decorative colour on data is prohibited.

**The Borrowed Accent Rule.** The accent belongs to the user. Never hard-code the default indigo (#6366f1) or a theme accent in a component; always read `var(--accent)` and its derived tokens, and check legibility of white text on light accents.

**The Contrast Floor Rule.** Text meets WCAG AA (4.5:1, 3:1 for 18px+ bold) in all four themes. Muted text is for labels and reconciled rows, never for figures the user must act on.

## Typography

**Display Font:** Inter (vendored locally, with sans-serif fallback)
**Body Font:** Inter
**Label/Mono Font:** system monospace only for codes (licence key, recovery code)

**Character:** One sober grotesque throughout; hierarchy comes from weight and size, and figures use tabular numerals so columns line up like a ledger.

### Hierarchy
- **Headline** (700, 24px, 1.2): view titles ("Dashboard", "Synthèse financière").
- **Title** (600, 16px, 1.3): card and panel titles.
- **Body** (400, 14px, 1.5): descriptions, table cells, form text.
- **Data** (600, 14px, tabular numerals): amounts and balances; hero figures scale up to 28–40px inside KPI cards.
- **Label** (600, 12px, 0.04em, uppercase allowed): column headers, field labels, section eyebrows.

### Named Rules
**The 12-Pixel Floor Rule.** Functional text (labels, table cells, buttons, badges, metadata) is never below 12px on desktop and 13px on phone. 11px is reserved for non-interactive fine print. The current codebase has many 10–11.5px sizes; they are debt to retire, not precedent.

**The Tabular Figures Rule.** Every amount, balance, percentage and date column uses `font-variant-numeric: tabular-nums` and is right-aligned in tables.

## Layout

Desktop: top navigation bar, a fixed left sidebar of account balances and key indicators (comptes & livrets, reste à vivre, prochaine paie, budgets, tirelires), and a main workspace that holds tables and cards. Phone (≤768px): header with menu, profile and notifications; content in a single column; tables become stacked cards. Breakpoints in use: 1024px and 768px.

Spacing follows a 4px base (4 / 8 / 16 / 24 / 32). Table rows are compact on desktop (about 44–48px). On phone, a transaction is shown as a compact two-line item (label and amount, then category and status), not a full field-by-field card; primary actions sit within thumb reach at the bottom.

**The Reorganise-Don't-Shrink Rule.** On phone, a dense desktop component is redesigned for the phone, never just scaled down or wrapped until labels overlap. No horizontal page scroll; wide tables scroll inside their own container with a sticky first column.

## Elevation & Depth

Depth comes from tonal layering: page background, then surface, then input, each one step apart, separated by thin rule lines. Shadows are minimal and reserved for floating layers (menus, modals, toasts).

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.24)`): subtle lift for cards in dark themes.
- **Floating** (`box-shadow: 0 8px 16px 0 rgba(0, 0, 0, 0.24)`): dropdowns, popovers, modals.

### Named Rules
**The Flat Ledger Rule.** Rows and cards rest flat; only things that float above the page (menus, dialogs, toasts) get a real shadow. Floating banners never cover data the user is reading.

## Shapes

Gently curved, functional corners: 4px for chips and badges, 6–8px for buttons and inputs, 12px for cards and panels, full pill for toggles and filter chips. Borders are 1px rule lines; a 3px left edge in an account or category colour marks ownership on cards and rows.

## Components

### Buttons
- **Shape:** gently curved (8px).
- **Primary:** profile accent background, white label, 8px 16px padding; one per screen or per panel.
- **Hover / Focus:** deeper accent on hover; visible 2px accent focus ring on keyboard focus.
- **Secondary:** translucent neutral fill with main text colour; for frequent secondary actions.
- **Destructive:** red outline or text, never a primary-weight red block beside routine actions.

### Chips
- **Style:** category chips on the input tone with main text, 4px corners; account filter chips outlined in the account colour.
- **State:** selected filter chip filled with its colour; unselected outlined.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** surface tone on page background.
- **Shadow Strategy:** flat or resting (see Elevation).
- **Border:** 1px rule line; optional 3px left edge in the owning account's colour.
- **Internal Padding:** 16px (24px for KPI cards).

### Inputs / Fields
- **Style:** input tone background, 1px rule border, 8px corners.
- **Focus:** border and 2px ring in the profile accent.
- **Error / Disabled:** red border with message under the field; disabled at reduced opacity, never below contrast floor for its label.

### Navigation
- **Desktop:** horizontal top bar, icon above label; active item in profile accent with a subtle accent fill. Grouping of the 13 destinations is an open design question.
- **Phone:** menu drawer today; a bottom tab bar for the main destinations is the intended direction.

### Ledger Table (signature)
Date, description, category, amount, reconciliation, actions. Amounts right-aligned in tabular numerals and coloured by direction; reconciled rows recede to muted text; unreconciled rows keep full contrast and an amber or accent marker. Row actions stay quiet until hover on desktop.

### KPI Cockpit Card (signature)
One hero figure (reste à vivre, dépenses pointées), a ring or gauge for proportion, one line of context below. Never repeat the hero figure in the context line.

## Do's and Don'ts

### Do:
- **Do** read the accent from `var(--accent)` so the profile colour drives the interface.
- **Do** keep each account's colour identical across sidebar, chips, cards and charts.
- **Do** use one stroke-icon set that inherits `currentColor`.
- **Do** use tabular numerals and right alignment for every amount.
- **Do** check every change in Classique sombre, Titanium sombre and one light theme, at 1920×1200 and 390×844.

### Don't:
- **Don't** use emoji as interface icons in navigation, buttons or headers.
- **Don't** set functional text below 12px (13px on phone).
- **Don't** hard-code colours in inline styles; use theme tokens so all four themes follow.
- **Don't** let floating banners or toasts cover table rows or figures.
- **Don't** use colour on figures for decoration; colour means account or money direction.
