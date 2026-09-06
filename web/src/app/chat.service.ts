import { Injectable } from '@angular/core';
import { ChatEvent, ChatTurn } from './models';

@Injectable({ providedIn: 'root' })
export class ChatService {
  /**
   * POSTs the conversation and yields the server's SSE events
   * (`sources`, `delta`, `done`, `error`) as they arrive.
   */
  async *stream(messages: ChatTurn[], signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => undefined);
      yield { type: 'error', message: body?.error ?? `Erreur serveur (${res.status})` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSse(rawEvent);
        if (event) yield event;
      }
    }
  }
}

function parseSse(raw: string): ChatEvent | undefined {
  let eventName = '';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) eventName = line.slice(7).trim();
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (!eventName) return undefined;

  try {
    const payload = data ? JSON.parse(data) : undefined;
    switch (eventName) {
      case 'sources':
        return { type: 'sources', sources: payload };
      case 'delta':
        return { type: 'delta', text: payload.text };
      case 'done':
        return { type: 'done' };
      case 'error':
        return { type: 'error', message: payload.message };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
