import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../api.service';
import { ChatService } from '../../chat.service';
import { ChatTurn, Segment, SourceRef, UiMessage } from '../../models';

@Component({
  selector: 'app-chat',
  imports: [FormsModule],
  templateUrl: './chat.html',
})
export class Chat {
  protected readonly api = inject(ApiService);
  private readonly chatService = inject(ChatService);

  protected readonly messages = signal<UiMessage[]>([]);
  protected readonly busy = signal(false);
  protected readonly activeSource = signal<SourceRef | null>(null);
  protected draft = '';

  private abortController: AbortController | null = null;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly suggestions = [
    'Fais-moi un résumé de ce document.',
    'Quels sont les points clés à retenir ?',
    'Que dit le document au sujet de… ?',
  ];

  protected async send(text?: string): Promise<void> {
    const question = (text ?? this.draft).trim();
    if (!question || this.busy()) return;
    this.draft = '';

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
      for await (const event of this.chatService.stream(turns, this.abortController.signal)) {
        switch (event.type) {
          case 'sources':
            this.patchLast((m) => ({ ...m, sources: event.sources }));
            break;
          case 'delta':
            this.patchLast((m) => ({ ...m, content: m.content + event.text }));
            this.scrollDown();
            break;
          case 'error':
            this.patchLast((m) => ({ ...m, error: event.message, streaming: false }));
            break;
          case 'done':
            break;
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        this.patchLast((m) => ({ ...m, error: 'Connexion au serveur impossible.', streaming: false }));
      }
    } finally {
      this.patchLast((m) => ({ ...m, streaming: false }));
      this.busy.set(false);
      this.abortController = null;
      this.scrollDown();
    }
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
   * Splits the answer into template-rendered segments. Angular's HTML sanitizer
   * strips <button> from [innerHTML], so citations have to be real elements.
   */
  protected segments(message: UiMessage): Segment[] {
    const segments: Segment[] = [];
    const pattern = /\*\*([^*]+)\*\*|\[(\d{1,2})\]/g;
    let cursor = 0;

    for (const match of message.content.matchAll(pattern)) {
      if (match.index > cursor) {
        segments.push({ kind: 'text', text: message.content.slice(cursor, match.index) });
      }
      if (match[1] !== undefined) {
        segments.push({ kind: 'bold', text: match[1] });
      } else {
        segments.push({ kind: 'cite', index: Number(match[2]) });
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < message.content.length) {
      segments.push({ kind: 'text', text: message.content.slice(cursor) });
    }
    return segments;
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
