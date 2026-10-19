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

  it('renders HTML inside list items and headings as text', () => {
    const root = render([{ role: 'assistant', content: `### ${PAYLOADS}\n- ${PAYLOADS}\n1. **${PAYLOADS}**` }]);
    assertNoMarkup(root);
    expect(root.querySelector('h4')?.textContent).toContain('<script>');
  });

  it('keeps forged citation markers inside list items as plain text', () => {
    const root = render([{ role: 'assistant', content: '- Real [1]\n- Forged [7]', sources: [source(1)] }]);
    const buttons = [...root.querySelectorAll('li button.cite')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['1']);
  });
});

describe('Chat Markdown rendering', () => {
  let fixture: ComponentFixture<Chat>;

  const render = (content: string, sources: SourceRef[] = []) => {
    (fixture.componentInstance as unknown as { messages: WritableSignal<UiMessage[]> }).messages.set([
      { role: 'assistant', content, sources },
    ]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const source: SourceRef = { index: 1, docId: 'doc', docName: 'report.pdf', page: 3, snippet: 's', score: 0.9 };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Chat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(Chat);
  });

  it('renders bullet and numbered lists, with bold and citations inside items', () => {
    const root = render('Intro:\n- **First** [1]\n- Second\n\n1. One\n2. Two', [source]);
    const bullets = root.querySelectorAll('ul > li');
    expect(bullets.length).toBe(2);
    expect(bullets[0]!.querySelector('strong')?.textContent).toBe('First');
    expect(bullets[0]!.querySelector('button.cite')?.textContent?.trim()).toBe('1');
    expect(root.querySelectorAll('ol > li').length).toBe(2);
    expect(root.querySelector('p.whitespace-pre-wrap')?.textContent).toBe('Intro:');
    expect(root.textContent).not.toContain('- ');
  });

  it('keeps a loose list (blank lines between items) as one list', () => {
    const root = render('- a\n\n- b\n\n- c');
    expect(root.querySelectorAll('ul').length).toBe(1);
    expect(root.querySelectorAll('ul > li').length).toBe(3);
  });

  it('resumes an ordered list at its own number', () => {
    const root = render('3. Third\n4. Fourth');
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('copies the answer as plain text followed by the cited sources', async () => {
    let written = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => ((written = text), Promise.resolve()) },
    });
    const root = render('### Budget\n- **Hosting**: €20/month [1]', [source]);
    (root.querySelector('button.copy') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(written).toBe('Budget\n- Hosting: €20/month [1]\n\nSources:\n[1] report.pdf, p. 3');
  });
});
