export type CliOptions = Record<string, string | boolean | undefined>;

export type CommandHandler = (options: CliOptions) => void;

export function dispatchCommand(
  command: string | undefined,
  options: CliOptions,
  handlers: Record<string, CommandHandler>
): boolean {
  if (!command) {
    return false;
  }

  const handler = handlers[command];
  if (!handler) {
    return false;
  }

  handler(options);
  return true;
}