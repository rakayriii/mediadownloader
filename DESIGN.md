---
name: Minimalist SaaS Dark
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#c4c6d2'
  on-tertiary: '#2d303a'
  tertiary-container: '#a4a6b2'
  on-tertiary-container: '#393c46'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#e0e2ee'
  tertiary-fixed-dim: '#c4c6d2'
  on-tertiary-fixed: '#181b24'
  on-tertiary-fixed-variant: '#444651'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies a minimalist, highly refined SaaS aesthetic tailored for professional workflows, developer tools, and enterprise analytics. The brand personality is authoritative yet approachable, focusing on clarity, efficiency, and quiet confidence. 

The emotional response should be one of calm focus and control. By stripping away visual noise and relying on a restrained palette, precise typography, and subtle depth transitions, the interface directs user attention strictly to data and core actions.

## Colors

The color system is anchored by a deep, near-black foundation that reduces eye strain in prolonged work sessions. Surfaces are mapped hierarchically using dark charcoals to establish clear containment without high-contrast visual barriers. 

- **Background:** `#090a0f` sets the deepest canvas level.
- **Surfaces:** `#12141c` for primary cards and containers; `#1a1d26` for elevated components and hover states.
- **Borders:** `#262b38` provides subtle structural lines.
- **Text:** `#f3f4f6` for high-emphasis headers and primary content; `#9ca3af` for secondary metadata and inactive states.
- **Accents:** A gradient-ready transition from cyan (`#06b6d4`) to blue (`#3b82f6`) highlights interactive elements, active states, and primary CTAs.

## Typography

Typography balances technical precision with high readability. Geist provides a sharp, contemporary geometric voice for headlines, while Inter ensures exceptional legibility across dense data displays and body copy at small sizes. 

Ensure that headline sizes above 28px scale down on viewports smaller than 768px to prevent awkward line wraps. Maintain strict adherence to the defined line heights to preserve the vertical rhythm of the interface.

## Layout & Spacing

The layout relies on a fluid 12-column grid system paired with a strict 8px spacing rhythm. This ensures predictable alignment across complex dashboards and data tables. 

On desktop viewports, maintain generous outer margins (`2rem` to `3rem`) to frame the application cleanly. On mobile devices, collapse side margins to `1rem` and switch multi-column data grids into stacked, single-column lists. Use consistent padding inside containers to let content breathe without feeling disconnected.

## Elevation & Depth

Depth is conveyed through subtle tonal layering and low-contrast outlines rather than heavy drop shadows. Because the palette is dark, elevation is achieved by lightening surface values incrementally as elements stack closer to the user.

- **Base Layer:** `#090a0f` (Background)
- **Layer 1:** `#12141c` (Cards, sidebars)
- **Layer 2:** `#1a1d26` (Dropdowns, modals, floating toolbars)
- **Outlines:** Use `#262b38` for structural boundaries. Avoid pure black shadows; instead, rely on 1px crisp borders and minimal ambient occlusion shadows (`0 4px 12px rgba(0, 0, 0, 0.4)`) only for floating overlays like modals and menus.

## Shapes

The design system uses a restrained "Soft" shape language that balances modern SaaS polish with structural discipline. 

- **Default Elements:** Inputs, buttons, and standard cards use a `0.25rem` (4px) or `0.375rem` (6px) border radius.
- **Large Containers:** Modals, dialogs, and prominent cards use `0.5rem` (8px) to `0.75rem` (12px) radii.
- **Badges & Pills:** Fully rounded (`9999px`) for status indicators and tags. 

Avoid overly organic or pill-shaped primary containers; crisp, controlled corners reinforce the technical, enterprise-grade nature of the application.

## Components

### Buttons
- **Primary:** Solid cyan/blue accent gradient (`#06b6d4` to `#3b82f6`) with off-white text. Subtle brightness shift on hover.
- **Secondary:** Surface color `#1a1d26` with a `#262b38` border and primary text color.
- **Ghost:** Transparent background with text hover states, used for low-priority actions.

### Inputs & Form Fields
- Use `#12141c` for input backgrounds with a `#262b38` border. On focus, transition the border to the cyan accent (`#06b6d4`) with a 1px glow ring. Include clear, persistent label text above the input rather than relying solely on placeholder text.

### Cards
- Constructed with `#12141c` surfaces and `#262b38` borders. Internal padding should follow the `space-lg` token. Interactive cards must subtly lighten their surface color to `#1a1d26` on hover.

### Lists & Data Tables
- Rows should feature clean horizontal dividers in `#262b38`. Apply subtle background shifts on row hover to improve scannability in dense information architectures.

### Checkboxes & Radio Buttons
- Unchecked states use `#1a1d26` backgrounds with `#262b38` borders. Checked states fill entirely with the cyan accent and feature a crisp, off-white checkmark or indicator dot.

### Additional SaaS Components
- **Status Badges:** Use low-opacity tinted backgrounds paired with bright text for states (e.g., green for active, amber for pending, red for error).
- **Command Palettes:** Centered overlays with heavy blur (`backdrop-filter: blur(12px)`), dark translucent surfaces, and refined keyboard shortcut indicators.