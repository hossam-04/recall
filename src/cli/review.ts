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
  console.log(summarise(deck, now));
  if (!summarise(deck, now).startsWith("Nothing")) {
    console.log("Ctrl-C to stop; progress is saved as you go.\n");
  } else {
    return 0;
  }

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

main().then((code) => process.exit(code));
