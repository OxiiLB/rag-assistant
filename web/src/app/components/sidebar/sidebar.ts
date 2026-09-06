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
    this.api.refreshDocuments().catch(() => this.error.set('Serveur injoignable. Lancez `npm run dev` dans server/.'));
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.upload(file);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.upload(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  private async upload(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('Seuls les fichiers PDF sont acceptés.');
      return;
    }
    this.error.set(null);
    this.uploading.set(file.name);
    try {
      await this.api.uploadDocument(file);
    } catch (err: unknown) {
      const message = (err as { error?: { error?: string } })?.error?.error;
      this.error.set(message ?? `Échec de l'indexation de « ${file.name} ».`);
    } finally {
      this.uploading.set(null);
    }
  }

  protected async remove(doc: DocumentMeta): Promise<void> {
    if (!confirm(`Supprimer « ${doc.name} » et son index ?`)) return;
    this.deleting.set(doc.id);
    try {
      await this.api.deleteDocument(doc.id);
    } catch {
      this.error.set('La suppression a échoué.');
    } finally {
      this.deleting.set(null);
    }
  }

  protected fileUrl(doc: DocumentMeta): string {
    return this.api.fileUrl(doc.id);
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  }
}
