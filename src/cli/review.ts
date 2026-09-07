import { createInterface } from "node:readline/promises";
import { loadDeck, saveDeck } from "./deck-file.js";
import { InputClosed, runSession, summarise, type Ask } from "./session.js";

/** `rl.question()` never resolves if the stream closes first, so a redirected
 *  stdin would hang the process forever rather than ending it. Racing against
 *  `close` turns that hang into an error the session can handle. */
function readlineAsk(rl: ReturnType<typeof createInterface>): Ask {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const onClose = () => reject(new InputClosed());
      rl.once("close", onClose);
      rl.question(prompt).then(
        (answer) => { rl.off("close", onClose); resolve(answer); },
        (error) => { rl.off("close", onClose); reject(error); },
      );
    });
}

async function main(): Promise<number> {
  const path = process.argv[2];
  if (path === undefined) {
    console.error("usage: npm run review -- <deck.json>");
    return 2;
  }

  const deck = await loadDeck(path);
  const now = new Date();
  const { due, message } = summarise(deck, now);
  console.log(message);
  if (due === 0) return 0;
  console.log("Ctrl-C to stop; progress is saved as you go.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await runSession(deck, now, {
      ask: readlineAsk(rl),
      save: (d) => saveDeck(path, d),
      print: (line) => console.log(line),
    });
    console.log(
      result.endedEarly
        ? `\nStopped. ${result.reviewed} reviewed, all saved.`
        : `Done. ${result.reviewed} reviewed.`,
    );
  } finally {
    rl.close();
  }
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    // Without this, a missing deck or malformed JSON is an unhandled rejection:
    // a stack trace rather than a message. Setting `exitCode` instead of
    // calling `process.exit` lets Node drain stdout before it leaves.
    console.error(error instanceof Error ? `recall: ${error.message}` : String(error));
    process.exitCode = 1;
  },
);
