import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../api.service';
import { ChatService } from '../../chat.service';
import { I18n } from '../../i18n';
import { NgTemplateOutlet } from '@angular/common';
import { Block, ChatTurn, Segment, SourceRef, UiMessage } from '../../models';
import { LangSwitch } from '../lang-switch/lang-switch';

@Component({
  selector: 'app-chat',
  imports: [FormsModule, LangSwitch, NgTemplateOutlet],
  templateUrl: './chat.html',
})
export class Chat {
  protected readonly api = inject(ApiService);
  private readonly chatService = inject(ChatService);
  protected readonly i18n = inject(I18n);

  protected readonly messages = signal<UiMessage[]>([]);
  protected readonly busy = signal(false);
  protected readonly activeSource = signal<SourceRef | null>(null);
  /** Answer just copied (keyed by identity, so it can't jump to another message) and whether it worked. */
  protected readonly copyFeedback = signal<{ message: UiMessage; ok: boolean } | null>(null);
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  protected draft = '';

  private abortController: AbortController | null = null;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly composerScroll = viewChild<ElementRef<HTMLElement>>('composerScroll');
  /** Per-message parse results; messages are immutable, so identity is a safe key. */
  private readonly blockCache = new WeakMap<UiMessage, Block[]>();
  private readonly citedCache = new WeakMap<UiMessage, SourceRef[]>();

  protected async send(text?: string): Promise<void> {
    const question = (text ?? this.draft).trim();
    if (!question || this.busy() || this.api.scopeCount() === 0) return;
    this.draft = '';
    // ngModel writes the empty value to the textarea on the next tick: measure after it.
    setTimeout(() => this.autoGrow(), 0);

    const history: ChatTurn[] = this.messages()
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    this.messages.update((msgs) => [
      ...msgs,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);
    this.busy.set(true);
    this.scrollDown();

    this.abortController = new AbortController();
    try {
      const turns = [...history, { role: 'user' as const, content: question }];
      const events = this.chatService.stream(turns, this.abortController.signal, this.api.scopeIds());
      for await (const event of events) {
        switch (event.type) {
          case 'sources':
            this.patchLast((m) => ({ ...m, sources: event.sources }));
            break;
          case 'delta':
            this.patchLast((m) => ({ ...m, content: m.content + event.text }));
            this.scrollDown();
            break;
          case 'error':
            this.patchLast((m) => ({
              ...m,
              error: this.i18n.error(event.code, event.params, event.message),
              streaming: false,
            }));
            break;
          case 'done':
            break;
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        this.patchLast((m) => ({ ...m, error: this.i18n.t('chat.unreachable'), streaming: false }));
      }
    } finally {
      this.patchLast((m) => ({ ...m, streaming: false }));
      this.busy.set(false);
      this.abortController = null;
      this.scrollDown();
    }
  }

  /**
   * Fits the input to its text so long questions stay readable. The wrapper caps
   * the height and scrolls; height is reset first so the input can also shrink.
   */
  protected autoGrow(): void {
    const el = this.composer()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    if (el.value) el.style.height = `${el.scrollHeight}px`;
    // The wrapper scrolls, not the textarea: keep the caret in view when typing at the end.
    const scroll = this.composerScroll()?.nativeElement;
    if (scroll && el.selectionEnd === el.value.length) scroll.scrollTop = scroll.scrollHeight;
  }

  protected stop(): void {
    this.abortController?.abort();
  }

  protected clear(): void {
    this.stop();
    this.messages.set([]);
    this.activeSource.set(null);
    this.showCopyFeedback(null);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  protected openCitation(message: UiMessage, index: number): void {
    const source = message.sources?.find((s) => s.index === index);
    if (source) this.activeSource.set(source);
  }

  protected sourceUrl(source: SourceRef): string {
    return this.api.fileUrl(source.docId, source.page);
  }

  /**
   * Parses the small Markdown subset the model uses (paragraphs, `#` headings,
   * `-` and `1.` lists) into blocks rendered by the template. No [innerHTML]:
   * Angular's sanitizer would strip the citation buttons, and model output that
   * read third-party documents must never become markup.
   */
  protected blocks(message: UiMessage): Block[] {
    // Messages are immutable (a streamed delta creates a new object), so past
    // answers are parsed once instead of on every change-detection pass.
    let blocks = this.blockCache.get(message);
    if (!blocks) {
      blocks = parseBlocks(message.content).map((block) => this.toBlock(block, message.sources));
      this.blockCache.set(message, blocks);
    }
    return blocks;
  }

  private toBlock(raw: RawBlock, sources: SourceRef[] | undefined): Block {
    return {
      kind: raw.kind,
      ordered: raw.ordered,
      start: raw.start,
      items: raw.items.map((text) => this.segments(text, sources)),
      children: raw.children?.map((child) => child && this.toBlock(child, sources)),
    };
  }

  /** Splits a line into text, **bold** runs and [n] citations backed by a real source. */
  private segments(text: string, sources: SourceRef[] | undefined): Segment[] {
    const segments: Segment[] = [];
    const pattern = /\*\*([^*]+)\*\*|\[(\d{1,2})\]/g;
    let cursor = 0;

    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) {
        segments.push({ kind: 'text', text: text.slice(cursor, match.index) });
      }
      const index = Number(match[2]);
      if (match[1] !== undefined) {
        segments.push({ kind: 'bold', text: match[1] });
      } else if (sources?.some((s) => s.index === index)) {
        segments.push({ kind: 'cite', index });
      } else {
        // A marker with no matching source (e.g. one a document tried to forge) stays plain text.
        segments.push({ kind: 'text', text: match[0] });
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
    }
    return segments;
  }

  /** Copies the answer as plain text, followed by the sources it cites. */
  protected async copy(message: UiMessage): Promise<void> {
    const body = message.content
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      // [ \t]* rather than \s*: \s would also eat the blank line before a heading.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .trim();
    const sources = this.citedSources(message).map((s) => `[${s.index}] ${s.docName}, p. ${s.page}`);
    const text = sources.length ? `${body}\n\n${this.i18n.t('chat.sourcesHeading')}\n${sources.join('\n')}` : body;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (non-secure origin or denied permission): say so on the button.
      ok = false;
    }
    this.showCopyFeedback({ message, ok });
  }

  protected copyState(message: UiMessage): 'ok' | 'failed' | null {
    const feedback = this.copyFeedback();
    if (feedback?.message !== message) return null;
    return feedback.ok ? 'ok' : 'failed';
  }

  private showCopyFeedback(feedback: { message: UiMessage; ok: boolean } | null): void {
    clearTimeout(this.copyTimer);
    this.copyFeedback.set(feedback);
    if (feedback) this.copyTimer = setTimeout(() => this.copyFeedback.set(null), 2000);
  }

  /** Sources actually cited in the answer, in order of first citation. */
  protected citedSources(message: UiMessage): SourceRef[] {
    let sources = this.citedCache.get(message);
    if (!sources) {
      const cited = new Set([...message.content.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
      sources = (message.sources ?? []).filter((s) => cited.has(s.index));
      this.citedCache.set(message, sources);
    }
    return sources;
  }

  private patchLast(patch: (m: UiMessage) => UiMessage): void {
    this.messages.update((msgs) => {
      const last = msgs.at(-1);
      if (!last || last.role !== 'assistant') return msgs;
      return [...msgs.slice(0, -1), patch(last)];
    });
  }

  private scrollDown(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}

/** A parsed block before inline parsing: same shape as Block, with raw strings. */
interface RawBlock {
  kind: Block['kind'];
  items: string[];
  ordered?: boolean;
  start?: number;
  children?: (RawBlock | undefined)[];
  /** Indent of the list's own items, to tell sub-items from siblings. */
  indent?: number;
}

/** Extra indent from which a list line counts as a sub-item of the previous item. */
const NESTED_INDENT = 2;

/**
 * Splits the answer into paragraphs, `#` headings and `-` / `1.` lists. Indented
 * list lines nest under the previous item (one level; deeper ones join that level).
 */
export function parseBlocks(content: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: RawBlock | undefined;
  let afterBlank = false;

  for (const line of content.split('\n')) {
    if (!line.trim()) {
      // Lists survive a blank line (loose lists); paragraphs end on one.
      if (current?.kind !== 'list') current = undefined;
      afterBlank = true;
      continue;
    }
    const indent = /^[ \t]*/.exec(line)![0].length;
    const heading = /^[ \t]*#{1,6}[ \t]+(.*)$/.exec(line);
    const bullet = /^[ \t]*[-*•][ \t]+(.*)$/.exec(line);
    const numbered = /^[ \t]*(\d{1,3})[.)][ \t]+(.*)$/.exec(line);

    if (heading) {
      blocks.push({ kind: 'heading', items: [heading[1]!] });
      current = undefined;
    } else if (bullet || numbered) {
      const ordered = numbered !== null;
      const text = numbered ? numbered[2]! : bullet![1]!;
      const start = numbered ? Number(numbered[1]) : undefined;
      if (current?.kind === 'list' && indent >= (current.indent ?? 0) + NESTED_INDENT) {
        const children = (current.children ??= []);
        const last = current.items.length - 1;
        const sub = (children[last] ??= { kind: 'list', ordered, start, items: [] });
        sub.items.push(text);
      } else if (current?.kind === 'list' && current.ordered === ordered) {
        current.items.push(text);
      } else {
        current = { kind: 'list', ordered, start, items: [text], indent };
        blocks.push(current);
      }
    } else if (current?.kind === 'list' && !afterBlank && indent > (current.indent ?? 0)) {
      // Indented continuation: belongs to the last item, or to its last sub-item.
      const last = current.items.length - 1;
      const sub = current.children?.[last];
      const target = sub ?? current;
      target.items[target.items.length - 1] += ` ${line.trim()}`;
    } else if (current?.kind === 'paragraph') {
      current.items[0] += `\n${line}`;
    } else {
      current = { kind: 'paragraph', items: [line] };
      blocks.push(current);
    }
    afterBlank = false;
  }
  return blocks;
}
