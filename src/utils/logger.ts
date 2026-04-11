import chalk from "chalk";

const PREFIX = chalk.bold("[vibe-racer]");

export const log = {
  info: (msg: string) => console.log(`${PREFIX} ${msg}`),
  success: (msg: string) => console.log(`${PREFIX} ${chalk.green(msg)}`),
  warn: (msg: string) => console.log(`${PREFIX} ${chalk.yellow(msg)}`),
  error: (msg: string) => console.error(`${PREFIX} ${chalk.red(msg)}`),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  guard: (msg: string) => console.log(`${PREFIX} ${chalk.cyan("🔒")} ${msg}`),
};
