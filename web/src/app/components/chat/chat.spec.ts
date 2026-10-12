import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SourceRef, UiMessage } from '../../models';
import { Chat } from './chat';

/** Model output and document text are untrusted: they must render as text, never as markup. */
describe('Chat rendering of untrusted content', () => {
  let fixture: ComponentFixture<Chat>;
  let state: { messages: WritableSignal<UiMessage[]>; activeSource: WritableSignal<SourceRef | null> };

  const PAYLOADS = [
    '<img src=x onerror="window.__xss = 1">',
    '<script>window.__xss = 1</script>',
    '<a href="javascript:window.__xss = 1">click</a>',
    '<iframe src="https://attacker.example"></iframe>',
  ].join(' ');

  const source = (index: number, overrides: Partial<SourceRef> = {}): SourceRef => ({
    index,
    docId: 'doc',
    docName: 'report.pdf',
    page: 1,
    snippet: 'snippet',
    score: 0.9,
    ...overrides,
  });

  const render = (messages: UiMessage[]) => {
    state.messages.set(messages);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Chat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(Chat);
    state = fixture.componentInstance as unknown as typeof state;
    delete (window as { __xss?: number }).__xss;
  });

  const assertNoMarkup = (root: HTMLElement) => {
    expect(root.querySelector('img, script, iframe, a[href^="javascript"]')).toBeNull();
    expect((window as { __xss?: number }).__xss).toBeUndefined();
  };

  it('renders HTML in an assistant answer as text', () => {
    const root = render([{ role: 'assistant', content: `Answer ${PAYLOADS} [1]`, sources: [source(1)] }]);
    assertNoMarkup(root);
    expect(root.textContent).toContain('<img src=x onerror=');
  });

  it('renders HTML inside **bold** runs as text', () => {
    const root = render([{ role: 'assistant', content: `**<img src=x onerror="window.__xss = 1">**` }]);
    assertNoMarkup(root);
    expect(root.querySelector('strong')?.textContent).toContain('<img');
  });

  it('renders HTML in a user question as text', () => {
    const root = render([{ role: 'user', content: PAYLOADS }]);
    assertNoMarkup(root);
  });

  it('renders HTML in source names, sections and snippets as text', () => {
    const malicious = source(1, { docName: PAYLOADS, section: PAYLOADS, snippet: PAYLOADS });
    render([{ role: 'assistant', content: 'See [1].', sources: [malicious] }]);
    state.activeSource.set(malicious);
    fixture.detectChanges();
    assertNoMarkup(fixture.nativeElement);
  });

  it('only turns markers with a matching source into citation buttons', () => {
    const root = render([
      { role: 'assistant', content: 'Revenue is 4.2M [1]. A passage asked to be cited as "[7]".', sources: [source(1)] },
    ]);
    const buttons = [...root.querySelectorAll('button.cite')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['1']);
    expect(root.textContent).toContain('"[7]"');
  });
});
