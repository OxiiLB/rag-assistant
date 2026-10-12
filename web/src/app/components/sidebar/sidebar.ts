import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../api.service';
import { DocumentMeta } from '../../models';

@Component({
  selector: 'app-sidebar',
  imports: [DatePipe],
  templateUrl: './sidebar.html',
})
export class Sidebar {
  protected readonly api = inject(ApiService);

  protected readonly uploading = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);

  constructor() {
    const unreachable = () => this.error.set('Server unreachable. Run `npm run dev` in server/.');
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
    const errors: string[] = [];
    this.error.set(null);
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        errors.push(`"${file.name}": only PDF files are accepted.`);
        continue;
      }
      this.uploading.set(file.name);
      try {
        await this.api.uploadDocument(file);
      } catch (err: unknown) {
        const message = (err as { error?: { error?: string } })?.error?.error;
        errors.push(`"${file.name}": ${message ?? 'upload failed.'}`);
      }
    }
    this.uploading.set(null);
    this.error.set(errors.length ? errors.join('\n') : null);
  }

  protected percent(doc: DocumentMeta): number {
    return Math.round((doc.progress ?? 0) * 100);
  }

  protected async remove(doc: DocumentMeta): Promise<void> {
    if (!confirm(`Delete "${doc.name}" and its index?`)) return;
    this.deleting.set(doc.id);
    try {
      await this.api.deleteDocument(doc.id);
    } catch {
      this.error.set('Deletion failed.');
    } finally {
      this.deleting.set(null);
    }
  }

  protected fileUrl(doc: DocumentMeta): string {
    return this.api.fileUrl(doc.id);
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
