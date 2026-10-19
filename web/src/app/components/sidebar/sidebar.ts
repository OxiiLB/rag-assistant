import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../api.service';
import { I18n } from '../../i18n';
import { DocumentMeta } from '../../models';

@Component({
  selector: 'app-sidebar',
  imports: [DatePipe],
  templateUrl: './sidebar.html',
})
export class Sidebar {
  protected readonly api = inject(ApiService);
  protected readonly i18n = inject(I18n);

  protected readonly uploading = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  /** Files refused during the last upload batch, shown together in a dialog. */
  protected readonly uploadErrors = signal<{ file: string; message: string }[]>([]);
  private readonly uploadDialog = viewChild<ElementRef<HTMLDialogElement>>('uploadDialog');

  constructor() {
    const unreachable = () => this.error.set(this.i18n.t('sidebar.unreachable'));
    this.api.refreshDocuments().catch(unreachable);
    this.api.loadHealth().catch(unreachable);
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void this.uploadAll(files);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (this.api.demoMode()) return;
    void this.uploadAll([...(event.dataTransfer?.files ?? [])]);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  /** Sends files one by one; indexing itself continues server-side and shows up as document status. */
  private async uploadAll(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const errors: { file: string; message: string }[] = [];
    this.error.set(null);
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        errors.push({ file: file.name, message: this.i18n.t('sidebar.onlyPdf') });
        continue;
      }
      this.uploading.set(file.name);
      try {
        await this.api.uploadDocument(file);
      } catch (err: unknown) {
        const body = (err as { error?: { error?: string; code?: string; params?: Record<string, string | number> } })
          ?.error;
        const message = this.i18n.error(body?.code, body?.params, body?.error ?? this.i18n.t('sidebar.uploadFailed'));
        errors.push({ file: file.name, message });
      }
    }
    this.uploading.set(null);
    this.uploadErrors.set(errors);
    // Native modal dialog: focus trap, Escape to close and top-layer rendering for free.
    if (errors.length) this.uploadDialog()?.nativeElement.showModal();
  }

  protected closeUploadDialog(): void {
    this.uploadDialog()?.nativeElement.close();
  }

  /** A click on the backdrop lands on the <dialog> itself, not on its content. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeUploadDialog();
  }

  protected percent(doc: DocumentMeta): number {
    return Math.round((doc.progress ?? 0) * 100);
  }

  protected async remove(doc: DocumentMeta): Promise<void> {
    if (!confirm(this.i18n.t('sidebar.confirmDelete', { name: doc.name }))) return;
    this.deleting.set(doc.id);
    try {
      await this.api.deleteDocument(doc.id);
    } catch {
      this.error.set(this.i18n.t('sidebar.deletionFailed'));
    } finally {
      this.deleting.set(null);
    }
  }

  protected fileUrl(doc: DocumentMeta): string {
    return this.api.fileUrl(doc.id);
  }

  protected formatSize(bytes: number): string {
    const fr = this.i18n.lang() === 'fr';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${fr ? 'Ko' : 'KB'}`;
    const mb = (bytes / 1024 / 1024).toLocaleString(this.i18n.lang(), { maximumFractionDigits: 1 });
    return `${mb} ${fr ? 'Mo' : 'MB'}`;
  }
}
