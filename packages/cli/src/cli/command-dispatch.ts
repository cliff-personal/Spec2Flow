export type CliOptions = Record<string, string | boolean | undefined>;

export type CommandHandler = (options: CliOptions) => void | Promise<void>;

export async function dispatchCommand(
  command: string | undefined,
  options: CliOptions,
  handlers: Record<string, CommandHandler>
): Promise<boolean> {
  if (!command) {
    return false;
  }

  const handler = handlers[command];
  if (!handler) {
    return false;
  }

  await handler(options);
  return true;
}
