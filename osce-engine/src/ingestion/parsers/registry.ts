/**
 * Document parser registry.
 *
 * Section 4.2 of the framework requires a parser per format with an explicit
 * failure state. The registry makes formats pluggable so that adding OCR or a
 * new office format is a registration, not a change to the pipeline.
 *
 * Design decision: parsers return *positioned* text blocks, not a flat string.
 * Provenance (page, line, character offsets) has to be captured at parse time -
 * reconstructing it later from a concatenated string is guesswork, and
 * guessed provenance is worse than none because it looks authoritative.
 */

import type { SourceFormat } from '../../domain/types.ts';
import { EngineError } from '../../domain/errors.ts';
import { assessTextQuality, normalizeForDisplay } from '../../text/normalize.ts';

/** One positioned unit of text from a source document. */
export interface TextBlock {
  readonly text: string;
  /** 1-based page number; null for formats without pagination. */
  readonly page: number | null;
  /** 1-based line number within the document. */
  readonly line: number;
  /** Character offset of this block within the full extracted text. */
  readonly charStart: number;
  readonly charEnd: number;
}

export interface ParseResult {
  readonly blocks: readonly TextBlock[];
  /** Full normalized text, for hashing and for excerpt slicing. */
  readonly fullText: string;
  readonly pageCount: number | null;
  readonly warnings: readonly string[];
}

export interface DocumentParser {
  readonly format: SourceFormat;
  readonly version: string;
  parse(bytes: Uint8Array): ParseResult;
}

/**
 * Splits already-decoded text into positioned blocks.
 *
 * A "block" is a non-empty line. Line granularity is the right unit because it
 * is what a reviewer sees when the excerpt is shown back to them, and because
 * OSCE recall files are overwhelmingly line-structured (one question per line).
 */
export function blocksFromText(text: string, pageBreaks: readonly number[] = []): ParseResult {
  const normalized = normalizeForDisplay(text);
  const blocks: TextBlock[] = [];
  let offset = 0;
  let line = 0;

  for (const rawLine of normalized.split('\n')) {
    line++;
    const start = offset;
    const end = offset + rawLine.length;
    offset = end + 1; // account for the consumed newline
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    // Page number = how many recorded page breaks precede this offset.
    let page: number | null = null;
    if (pageBreaks.length > 0) {
      let p = 1;
      for (const breakOffset of pageBreaks) {
        if (start >= breakOffset) p++;
        else break;
      }
      page = p;
    }
    blocks.push({ text: trimmed, page, line, charStart: start, charEnd: end });
  }

  return {
    blocks,
    fullText: normalized,
    pageCount: pageBreaks.length > 0 ? pageBreaks.length + 1 : null,
    warnings: [],
  };
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Plain text and Markdown: decode, normalize, split. */
export const textParser: DocumentParser = {
  format: 'txt',
  version: 'txt-1.0.0',
  parse(bytes: Uint8Array): ParseResult {
    const text = decoder.decode(bytes);
    const quality = assessTextQuality(text);
    if (!quality.usable) {
      throw new EngineError('INVALID_TEXT', `Text is not usable: ${quality.reason}`, {
        letterRatio: quality.letterRatio,
        meanTokenLength: quality.meanTokenLength,
      });
    }
    return blocksFromText(text);
  },
};

/**
 * Markdown parser.
 *
 * Strips only the syntax that would otherwise leak into candidate text
 * (heading markers, emphasis, list bullets). Structure is preserved because the
 * segmenter uses heading depth as a grouping signal.
 */
export const markdownParser: DocumentParser = {
  format: 'md',
  version: 'md-1.0.0',
  parse(bytes: Uint8Array): ParseResult {
    const raw = decoder.decode(bytes);
    const quality = assessTextQuality(raw);
    if (!quality.usable) {
      throw new EngineError('INVALID_TEXT', `Text is not usable: ${quality.reason}`, {
        reason: quality.reason,
      });
    }
    const cleaned = raw
      .replace(/^```[\s\S]*?^```$/gm, '') // fenced code blocks
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s{0,3}(#{1,6})\s+/gm, '$1 ') // keep depth marker, drop spacing
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '');
    return blocksFromText(cleaned);
  },
};

export class ParserRegistry {
  private readonly parsers = new Map<SourceFormat, DocumentParser>();

  constructor(parsers: readonly DocumentParser[] = [textParser, markdownParser]) {
    for (const parser of parsers) this.parsers.set(parser.format, parser);
  }

  register(parser: DocumentParser): void {
    this.parsers.set(parser.format, parser);
  }

  has(format: SourceFormat): boolean {
    return this.parsers.has(format);
  }

  get(format: SourceFormat): DocumentParser {
    const parser = this.parsers.get(format);
    if (parser === undefined) {
      throw new EngineError('UNSUPPORTED_FORMAT', `No parser registered for format '${format}'`, {
        format,
        registered: [...this.parsers.keys()],
      });
    }
    return parser;
  }

  /** Composite version string. Changing any parser changes the extractor version. */
  get compositeVersion(): string {
    return [...this.parsers.values()]
      .map((p) => p.version)
      .sort()
      .join('+');
  }
}
