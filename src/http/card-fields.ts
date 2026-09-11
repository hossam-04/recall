/**
 * The only definition of what a card's text may be.
 *
 * This is a module of its own for the same reason src/db/sql.ts is. Two routes
 * create cards — POST /decks/:id/cards and POST /decks/import — and they live
 * in modules that already import each other in one direction. Putting the
 * shared schema in either one closes the loop, and an ES module cycle read at
 * the top level throws `Cannot access X before initialization` from whichever
 * module the runtime happened to load second. A leaf both sides import cannot
 * do that.
 *
 * Keeping one definition is not tidiness. If import validated more loosely than
 * the card route, import would be a side door for storing cards the product
 * says are invalid.
 */
import { z } from "zod";

export const CARD_FRONT = z.string().trim().min(1).max(1000);
export const CARD_BACK = z.string().trim().min(1).max(4000);
