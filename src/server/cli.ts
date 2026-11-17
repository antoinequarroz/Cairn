// Runs a command line tool (claude, codex) and hands over its standard output as a stream.
import "server-only";
import { spawn } from "node:child_process";

export type CliRun = {
  command: string;
  args: string[];
  stdin: string;
  env: Record<string, string>;
  cwd: string;
  signal: AbortSignal;
};

/** The tool's own words when it fails: its last lines of error output, cleaned. */
const tail = (stderr: string) =>
  stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Reading (additional )?(input|prompt) from stdin/.test(l))
    .slice(-3)
    .join(" ");

export class CliMissing extends Error {}

/**
 * Starts the tool. Rejects with CliMissing when it is not installed. The stream errors when the
 * tool exits with a failure; cancelling the stream, or aborting `signal`, stops the tool.
 * `onExit` runs once the process is gone, whatever happened.
 */
export function runCli(run: CliRun, onExit?: () => void): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const child = spawn(run.command, run.args, { cwd: run.cwd, env: run.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let started = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    let exited = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onExit?.();
    };

    const kill = () => {
      if (!exited) child.kill("SIGTERM");
    };
    run.signal.addEventListener("abort", kill, { once: true });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (closed || !controller) return;
      controller.enqueue(new Uint8Array(chunk));
      // Backpressure: stop reading the tool while the consumer is behind.
      if ((controller.desiredSize ?? 1) <= 0) child.stdout.pause();
    });

    child.on("error", (e: NodeJS.ErrnoException) => {
      run.signal.removeEventListener("abort", kill);
      if (!started) {
        finish();
        return reject(e.code === "ENOENT" ? new CliMissing(run.command) : e);
      }
      if (!closed) {
        closed = true;
        controller?.error(e);
      }
    });

    child.on("close", (code, signal) => {
      exited = true;
      run.signal.removeEventListener("abort", kill);
      finish();
      if (closed || !controller) return;
      closed = true;
      if (code === 0) controller.close();
      else controller.error(new Error(tail(stderr) || (signal ? `arrêté (${signal})` : `code de sortie ${code}`)));
    });

    child.on("spawn", () => {
      started = true;
      child.stdin.on("error", () => {}); // the tool may exit before reading everything
      child.stdin.end(run.stdin);
      resolve(
        new ReadableStream<Uint8Array>(
          {
            start(c) {
              controller = c;
            },
            pull() {
              child.stdout.resume();
            },
            cancel() {
              closed = true;
              kill();
            },
          },
          { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
        ),
      );
    });
  });
}
