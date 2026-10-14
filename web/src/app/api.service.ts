import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DocumentMeta, Health } from './models';

const POLL_MS = 1500;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  /** Shared document list (sidebar writes, chat reads for the empty state). */
  readonly documents = signal<DocumentMeta[]>([]);
  readonly readyCount = computed(() => this.documents().filter((d) => d.status === 'ready').length);
  /** Documents the visitor unticked; everything else is searched, so new uploads join the scope. */
  readonly excludedIds = signal<ReadonlySet<string>>(new Set());
  /** Sent as `docIds`; undefined while every ready document is selected (whole corpus). */
  readonly scopeIds = computed(() => {
    const ready = this.documents().filter((d) => d.status === 'ready');
    const selected = ready.filter((d) => !this.excludedIds().has(d.id));
    return selected.length === ready.length ? undefined : selected.map((d) => d.id);
  });
  readonly scopeCount = computed(() => this.scopeIds()?.length ?? this.readyCount());

  isInScope(docId: string): boolean {
    return !this.excludedIds().has(docId);
  }

  toggleScope(docId: string): void {
    this.excludedIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(docId)) next.add(docId);
      return next;
    });
  }

  selectAll(): void {
    this.excludedIds.set(new Set());
  }
  /** Read-only public showcase: upload and delete are hidden. */
  readonly demoMode = signal(false);
  /** Generation model reported by the server, shown in the sidebar footer. */
  readonly model = signal<string | null>(null);

  async loadHealth(): Promise<void> {
    const health = await firstValueFrom(this.http.get<Health>('/api/health'));
    this.demoMode.set(health.demoMode);
    this.model.set(health.model);
  }

  async refreshDocuments(): Promise<void> {
    this.documents.set(await firstValueFrom(this.http.get<DocumentMeta[]>('/api/documents')));
    this.schedulePoll();
  }

  /** Indexing runs server-side after the upload returns; poll until no document is processing. */
  private schedulePoll(): void {
    if (this.pollTimer || !this.documents().some((d) => d.status === 'processing')) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      this.refreshDocuments().catch(() => this.schedulePoll());
    }, POLL_MS);
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
