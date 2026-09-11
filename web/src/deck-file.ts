/**
 * Reading and writing the deck file.
 *
 * `DECK_FORMAT` is duplicated from src/http/routes/decks.ts rather than
 * imported — the browser bundle and the server are separate TypeScript
 * projects, and the same duplication-with-a-comment convention already covers
 * the Stats type in api.ts. The server is the authority: it rejects anything
 * whose format string does not match, so a drift here fails loudly on import
 * rather than silently producing files nothing can read.
 */
export const DECK_FORMAT = "recall.deck.v1";

export type DeckFile = { format: string; name: string; cards: { front: string; back: string }[] };

/**
 * Saves the file through a blob URL and a synthetic click.
 *
 * There is no server round trip and no Content-Disposition header: the export
 * route answers with plain JSON like every other route, and turning that into
 * a file is a browser concern. Revoking on a timeout rather than immediately —
 * revoking in the same tick as the click races the download in some browsers,
 * and the failure is an empty file rather than an error.
 */
export function downloadDeckFile(file: DeckFile): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${file.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.recall.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Parses a chosen file in the browser. Nothing is uploaded — the server only
 * ever sees the JSON body, so there is no multipart handling and no file on
 * disk anywhere near it.
 *
 * The format check is repeated here purely so choosing the wrong file says so
 * immediately instead of after a round trip. The server does not trust this.
 */
export function parseDeckFile(text: string): DeckFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON.");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as DeckFile).format !== DECK_FORMAT || !Array.isArray((parsed as DeckFile).cards)
  ) {
    throw new Error("That is not a recall deck file.");
  }
  return parsed as DeckFile;
}
