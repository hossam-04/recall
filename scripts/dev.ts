import { spawn, type ChildProcess } from "node:child_process";

/**
 * Runs the API and Vite together.
 *
 * Replaces `npm run dev:api & npm run dev:web`, which had two faults. The
 * backgrounded process is not owned by anything, so Ctrl-C kills the foreground
 * one and leaves the other listening — the next run then fails with EADDRINUSE
 * against a server nobody remembers starting. And it inherits whatever `PORT`
 * the surrounding tool exported: a launcher that sets PORT=5173 for the web
 * server makes the API try to bind 5173 too, which fails with a message about
 * a port nothing in this file mentions.
 *
 * So the ports are decided here and passed explicitly, and both children die
 * with the parent.
 */
const API_PORT = process.env["API_PORT"] ?? "3000";
const WEB_PORT = process.env["WEB_PORT"] ?? "5173";

const children: ChildProcess[] = [];

function start(name: string, command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    // `...process.env` first so the explicit values below win over anything
    // inherited. That precedence is the whole point.
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    console.error(`\n${name} exited (${code ?? "signal"}); stopping the other.`);
    stop();
    process.exitCode = code ?? 1;
  });
  children.push(child);
}

function stop(): void {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });

start("api", "npx", ["tsx", "watch", "--env-file-if-exists=.env", "src/index.ts"], {
  PORT: API_PORT,
});
start("web", "npx", ["vite", "--config", "web/vite.config.ts"], {
  WEB_PORT,
  API_PORT,
});

console.log(`api → http://127.0.0.1:${API_PORT}   ui → http://127.0.0.1:${WEB_PORT}`);
