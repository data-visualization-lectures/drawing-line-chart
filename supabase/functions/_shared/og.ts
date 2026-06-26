export const BOT_UA_PATTERN =
  /Twitterbot|facebookexternalhit|Facebot|LinkedInBot|Slackbot|Discordbot|LINE|Googlebot|bingbot/i;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBotUserAgent(req: Request) {
  return BOT_UA_PATTERN.test(req.headers.get("user-agent") || "");
}

export function readUuidSearchParam(url: URL, name = "id") {
  const value = url.searchParams.get(name)?.trim() || "";
  return UUID_PATTERN.test(value) ? value : null;
}

export function escapeToAsciiHtml(str: string): string {
  let result = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (ch === "&") result += "&amp;";
    else if (ch === '"') result += "&quot;";
    else if (ch === "<") result += "&lt;";
    else if (ch === ">") result += "&gt;";
    else if (code > 127) result += `&#x${code.toString(16)};`;
    else result += ch;
  }
  return result;
}
