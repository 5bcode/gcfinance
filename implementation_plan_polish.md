# Implementation Plan - UI Polish & Smoothing

The goal is to enhance the visual fidelity or "smoothness" of the application, making it feel like a finished, premium product.

## User Request
"Make it look more finished and smoother"

## Proposed Changes

### 1. Chart Visuals & Interaction (Completed)
- [x] **Smooth Curves**: Replaced jagged line charts with Catmull-Rom spline interpolation for smooth cumulative growth lines.
- [x] **Interactive Hover**: Added a vertical highlight bar and a floating tooltip that follows the cursor.
- [x] **Visual Hierarchy**: Improved the distinction between "Monthly" bars and "Cumulative" lines using gradients and shadows.

### 2. UI Micro-interactions (Proposed)
- [ ] **Table Row Entry**: Add staggered fade-in animations for table rows when they render, so the list feels dynamic rather than static.
- [ ] **Button States**: Refine active/pressed states for buttons to give better tactile feedback.
- [ ] **Input Focus**: Enhance focus transitions for inputs in the tables.

### 3. General "Finished" Look (Proposed)
- [ ] **Empty States**: Ensure empty states (no accounts, no goals) have nice illustrations or icons (currently simple text).
- [ ] **Scrollbars**: Refine custom scrollbar styling to blend better with the dark theme (already present, but verify smoothness).
- [ ] **Toast Notifications**: Ensure toasts slide in/out smoothly (already in `styles.css` but check timing).

## Verification Plan
1.  **Chart**: Hove over the chart to verify the tooltip follows smoothly and the cumulative lines are curved.
2.  **Tables**: Reload the app or add an item to see if valid rows animate in.
3.  **General**: Click around to ensure no jarring transitions.
