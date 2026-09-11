/**
 * SQL fragments shared by queries in more than one module.
 *
 * This file exists because of an import cycle. The filter started in
 * routes/cards.ts, which decks.ts then imported — but cards.ts already imports
 * `requireOwnedDeck` from decks.ts. Two modules importing each other is legal
 * in ES modules; what is not legal is reading a `const` from the other one
 * before it has finished evaluating, which is what a top-level query string
 * does. The result is "Cannot access 'CARD_IS_LIVE' before initialization".
 *
 * A fragment both of them need belongs to neither of them.
 */

/**
 * Migration 005 made card deletion a mark rather than a removal, so every read
 * of `cards` must exclude the dead ones. One string because five queries need
 * it, and a filter copied five times is a filter forgotten once.
 *
 * Every query that reads cards aliases the table `c`, so this fits all of them.
 */
export const CARD_IS_LIVE = "c.deleted_at is null";

/**
 * Migration 008 did the same to decks, and added a trap cards do not have: a
 * card in a deleted deck is still live by its own column. Anything reading
 * cards through a deck therefore needs *both* filters, or a deck you deleted
 * goes on serving cards to the review screen.
 *
 * Every query that reads decks aliases the table `d`. Two places deliberately
 * omit this and say so: the statistics queries, because a review of a card in a
 * deleted deck still happened, and account deletion, because closing an account
 * removes the dead rows along with the live ones.
 */
export const DECK_IS_LIVE = "d.deleted_at is null";
