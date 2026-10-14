import { Component, inject } from '@angular/core';
import { I18n, LANGS } from '../../i18n';

/** EN / FR segmented toggle. */
@Component({
  selector: 'app-lang-switch',
  template: `
    <div
      class="flex gap-0.5 rounded-lg border border-night-700 bg-night-800 p-0.5 font-mono text-[11px] font-medium tracking-[0.08em]"
      role="group"
      [attr.aria-label]="i18n.t('lang.switch')"
    >
      @for (lang of langs; track lang) {
        <button
          type="button"
          class="rounded px-2 py-1 uppercase transition-colors"
          [class]="i18n.lang() === lang ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:text-ink'"
          [attr.aria-pressed]="i18n.lang() === lang"
          (click)="i18n.lang.set(lang)"
        >
          {{ lang }}
        </button>
      }
    </div>
  `,
})
export class LangSwitch {
  protected readonly i18n = inject(I18n);
  protected readonly langs = LANGS;
}
