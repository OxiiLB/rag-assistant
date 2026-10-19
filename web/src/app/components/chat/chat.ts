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
  /** Position of the answer just copied, for the brief "Copied" feedback. */
  protected readonly copied = signal<number | null>(null);
  protected draft = '';

  private abortController: AbortController | null = null;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly composerScroll = viewChild<ElementRef<HTMLElement>>('composerScroll');

  protected async send(text?: string): Promise<void> {
    const question = (text ?? this.draft).trim();
    if (!question || this.busy() || this.api.scopeCount() === 0) return;
    this.draft = '';
    this.autoGrow();

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
    const raw: { kind: Block['kind']; items: string[]; ordered?: boolean; start?: number }[] = [];
    let current: (typeof raw)[number] | undefined;
    let afterBlank = false;

    for (const line of message.content.split('\n')) {
      if (!line.trim()) {
        // Lists survive a blank line (loose lists); paragraphs end on one.
        if (current?.kind !== 'list') current = undefined;
        afterBlank = true;
        continue;
      }
      const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);

      if (heading) {
        raw.push({ kind: 'heading', items: [heading[1]!] });
        current = undefined;
      } else if (bullet || numbered) {
        const ordered = numbered !== null;
        const text = numbered ? numbered[2]! : bullet![1]!;
        if (current?.kind === 'list' && current.ordered === ordered) {
          current.items.push(text);
        } else {
          current = { kind: 'list', ordered, start: numbered ? Number(numbered[1]) : undefined, items: [text] };
          raw.push(current);
        }
      } else if (current?.kind === 'list' && !afterBlank && /^\s/.test(line)) {
        // Indented continuation of the previous item.
        current.items[current.items.length - 1] += ` ${line.trim()}`;
      } else if (current?.kind === 'paragraph') {
        current.items[0] += `\n${line}`;
      } else {
        current = { kind: 'paragraph', items: [line] };
        raw.push(current);
      }
      afterBlank = false;
    }

    return raw.map((block) => ({ ...block, items: block.items.map((text) => this.segments(text, message.sources)) }));
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
  protected async copy(message: UiMessage, position: number): Promise<void> {
    const body = message.content
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .trim();
    const sources = this.citedSources(message).map((s) => `[${s.index}] ${s.docName}, p. ${s.page}`);
    const text = sources.length ? `${body}\n\n${this.i18n.t('chat.sourcesHeading')}\n${sources.join('\n')}` : body;
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(position);
      setTimeout(() => {
        if (this.copied() === position) this.copied.set(null);
      }, 2000);
    } catch {
      // Clipboard blocked (non-secure origin or denied permission): nothing to report.
    }
  }

  /** Sources actually cited in the answer, in order of first citation. */
  protected citedSources(message: UiMessage): SourceRef[] {
    if (!message.sources) return [];
    const cited = new Set([...message.content.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
    return message.sources.filter((s) => cited.has(s.index));
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
