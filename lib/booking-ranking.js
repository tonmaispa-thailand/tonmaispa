// Single source of truth for the booking "Choose a treatment" shortlist.
//
// Used by:
//   - components/ui/BookingEngine.jsx  (what guests actually see)
//   - app/dashboard/treatments/*       (admin live preview + the featured cap)
//   - app/api/admin/treatments/*       (server-side featured cap)
// Keeping the size and the ranking here means the admin preview can never
// drift from the real widget.

// The shortlist shows at most this many treatments. The admin caps how many
// treatments may be marked `is_featured` at the SAME number, so every featured
// treatment is guaranteed a slot and the list never silently drops one.
export const BOOKING_TOP_N = 5

// Build the shortlist in priority order (first match wins, deduped, capped):
//   1. Owner-pinned `is_featured` — in the caller's given order (menu order).
//   2. Auto best-sellers from `popularIds` (rolling booking volume).
//   3. Anything left, to top the list up to BOOKING_TOP_N.
// `add_on` items and inactive treatments never appear. Order follows the given
// array, so callers must pass treatments already sorted by sort_order for the
// featured/fill slots to match the real widget: BookingEngine's query does
// .order('sort_order'), and the dashboard preview sorts its copy the same way
// before calling (its list query orders by category first, which would drift).
export function rankBookingTopN({ treatments = [], popularIds = [] }) {
  const eligible = treatments.filter(t => t.is_active !== false && t.category !== 'add_on')
  const byId = new Map(eligible.map(t => [t.id, t]))
  const featured = eligible.filter(t => t.is_featured)
  const popular = popularIds.map(id => byId.get(id)).filter(Boolean)
  const seen = new Set()
  const result = []
  for (const t of [...featured, ...popular, ...eligible]) {
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    result.push(t)
    if (result.length === BOOKING_TOP_N) break
  }
  return result
}

// Why each treatment earned its slot — drives the admin preview's little tags.
// featured always wins the label even if it is also a best-seller.
export function bookingSlotReason(treatment, popularIds = []) {
  if (treatment.is_featured) return 'featured'
  if (popularIds.includes(treatment.id)) return 'bestseller'
  return 'fill'
}
