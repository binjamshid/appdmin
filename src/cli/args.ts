export interface ParsedArgs {
  command: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token.startsWith("--")) {
      command.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    if (equal > 2) {
      options[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index++;
    } else options[key] = true;
  }
  return { command, options };
}

export function optionString(
  parsed: ParsedArgs,
  key: string,
  fallback?: string,
): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : fallback;
}
