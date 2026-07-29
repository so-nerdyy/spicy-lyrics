// A deliberately strict, display-only filter for lyric text. It covers profanity,
// sexual language, slurs, drugs, and common obfuscated spellings while preserving
// whitespace and character count so synced syllable timing stays intact.

const BLOCKED_WORDS = [
  "anal", "ass", "asshole", "bastard", "bitch", "blowjob", "boob", "breast", "cock",
  "cocaine", "condom", "cuck", "cum", "cumming", "cunt", "damn", "dick", "drug",
  "ecstasy", "erection", "fag", "faggot", "fentanyl", "fuck", "fucker", "fucking",
  "goddamn", "handjob", "hell", "heroin", "horny", "jizz", "kike", "lsd", "marijuana",
  "meth", "molly", "motherfucker", "nigga", "nigger", "nipple", "nude", "nudity", "opioid",
  "orgasm", "penis", "piss", "porn", "pussy", "rape", "rapist", "rimjob", "semen", "sex",
  "sext", "sexual", "sexy", "shit", "slut", "tit", "titt", "vagina", "weed", "whore", "xanax",
] as const;

// Obfuscations that occur often enough in lyrics to be worth catching. The
// boundaries prevent harmless words such as "class" from being altered.
const BLOCKED_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${BLOCKED_WORDS.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")}|masturbat(?:e|es|ed|ing|ion)?|f+(?:[u*]+c+\**k+|\*{3,}(?:ing|er|ed|s)?)|sh+[i1!]+t+|b+[i1!]+t+c+h+|d+[i1!]+c+k+|c+[o0]+c+k+|s+[e3]+x+|p+[u*]+ss+y+|n+[i1!]+gg+[ae3]+r?)(?![\p{L}\p{N}])`,
  "giu"
);

const filteredTexts = new Map<string, string>();
const filteredPayloads = new WeakSet<object>();

function mask(match: string): string {
  return Array.from(match, (character) => (/\s/u.test(character) ? character : "•")).join("");
}

export function filterLyricText(text: string): string {
  const cached = filteredTexts.get(text);
  if (cached !== undefined) return cached;

  const filtered = text.replace(BLOCKED_PATTERN, mask);
  // Bound the cache: lyrics payloads are short-lived and this avoids retaining a
  // user's whole listening history during a long Spotify session.
  if (filteredTexts.size >= 2_000) filteredTexts.clear();
  filteredTexts.set(text, filtered);
  return filtered;
}

function filterEntry(entry: unknown): void {
  if (!entry || typeof entry !== "object") return;
  const lyric = entry as { Text?: unknown; TransliteratedText?: unknown };
  if (typeof lyric.Text === "string") lyric.Text = filterLyricText(lyric.Text);
  if (typeof lyric.TransliteratedText === "string") {
    lyric.TransliteratedText = filterLyricText(lyric.TransliteratedText);
  }
}

/**
 * Filters each lyric payload once, before any of the renderers create DOM nodes.
 * This protects static, line-synced, syllable-synced, background, and romanized
 * lyrics without adding work to the animation frame.
 */
export function filterLyricsPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object" || filteredPayloads.has(payload)) return;
  filteredPayloads.add(payload);

  const lyrics = payload as {
    Lines?: unknown[];
    Content?: Array<{
      Text?: unknown;
      Lead?: { Syllables?: unknown[] };
      Background?: Array<{ Syllables?: unknown[] }>;
    }>;
  };

  lyrics.Lines?.forEach(filterEntry);
  lyrics.Content?.forEach((line) => {
    filterEntry(line);
    line.Lead?.Syllables?.forEach(filterEntry);
    line.Background?.forEach((background) => background.Syllables?.forEach(filterEntry));
  });
}
