import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DocumentMeta } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** Shared document list (sidebar writes, chat reads for the empty state). */
  readonly documents = signal<DocumentMeta[]>([]);

  async refreshDocuments(): Promise<void> {
    this.documents.set(await firstValueFrom(this.http.get<DocumentMeta[]>('/api/documents')));
  }

  async uploadDocument(file: File): Promise<DocumentMeta> {
    const form = new FormData();
    form.append('file', file);
    const doc = await firstValueFrom(this.http.post<DocumentMeta>('/api/documents', form));
    await this.refreshDocuments();
    return doc;
  }

  async deleteDocument(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/documents/${id}`));
    await this.refreshDocuments();
  }

  fileUrl(docId: string, page?: number): string {
    return `/api/documents/${docId}/file${page ? `#page=${page}` : ''}`;
  }
}
