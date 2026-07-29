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

// Included in the compiled extension so a local install can be verified with
// `Select-String` before Spotify is restarted.
export const CONTENT_FILTER_BUILD_MARKER = "spicy-lyrics-content-filter-v2";

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

type SyllableEntry = {
  Text?: unknown;
  TransliteratedText?: unknown;
  IsPartOfWord?: unknown;
};

function filterSyllables(syllables: unknown[] | undefined): void {
  if (!syllables) return;

  for (let index = 0; index < syllables.length; index += 1) {
    const entries: SyllableEntry[] = [];
    let current = syllables[index] as SyllableEntry | undefined;
    if (!current || typeof current !== "object") continue;
    entries.push(current);

    // `IsPartOfWord` means this syllable joins directly to the next one. Treat
    // the complete reconstructed word as one unit, then split the equally sized
    // mask back over the original entries to preserve karaoke timing.
    while (current.IsPartOfWord && index + 1 < syllables.length) {
      index += 1;
      current = syllables[index] as SyllableEntry | undefined;
      if (!current || typeof current !== "object") break;
      entries.push(current);
    }

    for (const key of ["Text", "TransliteratedText"] as const) {
      if (!entries.every((entry) => typeof entry[key] === "string")) continue;
      const joined = entries.map((entry) => entry[key] as string).join("");
      const filtered = Array.from(filterLyricText(joined));
      let offset = 0;
      for (const entry of entries) {
        const length = Array.from(entry[key] as string).length;
        entry[key] = filtered.slice(offset, offset + length).join("");
        offset += length;
      }
    }
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
    filterSyllables(line.Lead?.Syllables);
    line.Background?.forEach((background) => filterSyllables(background.Syllables));
  });
}
