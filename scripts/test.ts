import { runTests } from "./runTests.ts";

const controller = new AbortController();
let signalExitCode = 0;
const interrupt = () => {
  signalExitCode = 130;
  controller.abort();
};
const terminate = () => {
  signalExitCode = 143;
  controller.abort();
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
try {
  process.exitCode = await runTests(process.cwd(), controller.signal);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  if (signalExitCode !== 0) process.exitCode = signalExitCode;
}
