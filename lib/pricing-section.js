// Shared constant behind the homepage "Simple, inclusive pricing" section's
// `show_in_pricing` flag (migration 037) — same pattern as
// lib/booking-ranking.js's BOOKING_TOP_N for `is_featured`: one exported
// number so the admin cap check (both create and edit routes) and the admin
// UI's disabled-checkbox logic can never drift apart on what the limit is.
//
// Capped lower than the booking widget's Top 5 (3, not 5) because this
// section's cards are large, single-price showcases (packages, in
// practice) meant to close a decision at the bottom of the homepage — a
// short, high-conviction list reads better here than a long one.
export const PRICING_SECTION_MAX = 3
