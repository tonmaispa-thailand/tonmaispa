// Unit test for lib/booking-ranking (pure logic, no DB).
//
// Run:  npm run test:ranking
//
// Guards the booking "Choose a treatment" shortlist — the exact ordering guests
// see and the admin preview mirrors. Covers featured-first, best-seller fill,
// dedupe, the cap, add_on/inactive exclusion, and backward-compatibility with
// the pre-featured behaviour.

import { rankBookingTopN, bookingSlotReason, BOOKING_TOP_N } from '@/lib/booking-ranking'

let ok = 0, bad = 0
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function check(name, cond, got) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { bad++; console.log(`  \x1b[31m✗\x1b[0m ${name} — got ${JSON.stringify(got)}`) }
}

// Menu order A..G (already sorted by sort_order), X = add_on, Z = inactive.
const BASE = [
  { id: 'A', category: 'massage' }, { id: 'B', category: 'massage' },
  { id: 'C', category: 'body' },    { id: 'D', category: 'massage' },
  { id: 'E', category: 'massage' }, { id: 'F', category: 'massage' },
  { id: 'G', category: 'massage' }, { id: 'X', category: 'add_on' },
  { id: 'Z', category: 'massage', is_active: false },
]
const withFeatured = (ids) => BASE.map(t => ({ ...t, is_featured: ids.includes(t.id) }))
const ids = (list) => list.map(t => t.id)
const POP = ['D', 'C'] // auto best-sellers

console.log('\nbooking-ranking')
check('constant is 5', BOOKING_TOP_N === 5, BOOKING_TOP_N)

// Backward-compat: no featured → best-sellers first, then menu order, capped 5.
check('no featured → popular then menu order',
  eq(ids(rankBookingTopN({ treatments: withFeatured([]), popularIds: POP })), ['D', 'C', 'A', 'B', 'E']),
  ids(rankBookingTopN({ treatments: withFeatured([]), popularIds: POP })))

// Featured pinned first, in menu order, ahead of best-sellers.
check('featured F,B pinned first (menu order B,F)',
  eq(ids(rankBookingTopN({ treatments: withFeatured(['F', 'B']), popularIds: POP })), ['B', 'F', 'D', 'C', 'A']),
  ids(rankBookingTopN({ treatments: withFeatured(['F', 'B']), popularIds: POP })))

// Featured that is also a best-seller appears once, in its featured position.
check('dedupe featured+popular (D)',
  eq(ids(rankBookingTopN({ treatments: withFeatured(['D']), popularIds: POP })), ['D', 'C', 'A', 'B', 'E']),
  ids(rankBookingTopN({ treatments: withFeatured(['D']), popularIds: POP })))

// >5 featured (defensive: cap still holds even though the admin blocks it).
check('7 featured → first 5 by menu order',
  eq(ids(rankBookingTopN({ treatments: withFeatured(['A', 'B', 'C', 'D', 'E', 'F', 'G']), popularIds: POP })), ['A', 'B', 'C', 'D', 'E']),
  ids(rankBookingTopN({ treatments: withFeatured(['A', 'B', 'C', 'D', 'E', 'F', 'G']), popularIds: POP })))

// add_on and inactive never appear, even if featured.
check('add_on X never shown',
  !ids(rankBookingTopN({ treatments: withFeatured(['X']), popularIds: POP })).includes('X'),
  ids(rankBookingTopN({ treatments: withFeatured(['X']), popularIds: POP })))
check('inactive Z never shown',
  !ids(rankBookingTopN({ treatments: withFeatured(['Z']), popularIds: POP })).includes('Z'),
  ids(rankBookingTopN({ treatments: withFeatured(['Z']), popularIds: POP })))

// Always caps at BOOKING_TOP_N.
check('caps at 5',
  rankBookingTopN({ treatments: withFeatured(['G']), popularIds: POP }).length === 5,
  rankBookingTopN({ treatments: withFeatured(['G']), popularIds: POP }).length)

// Slot reasons.
check('reason: featured', bookingSlotReason({ id: 'A', is_featured: true }, POP) === 'featured')
check('reason: bestseller', bookingSlotReason({ id: 'D' }, POP) === 'bestseller')
check('reason: fill', bookingSlotReason({ id: 'A' }, POP) === 'fill')

console.log(`\n${bad === 0 ? '\x1b[32m' : '\x1b[31m'}${ok} passed, ${bad} failed\x1b[0m\n`)
process.exit(bad === 0 ? 0 : 1)
