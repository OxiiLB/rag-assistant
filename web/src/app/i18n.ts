import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type Lang = 'en' | 'fr';
export const LANGS: Lang[] = ['en', 'fr'];

type Params = Record<string, string | number>;
type Entry = string | ((p: Params) => string);

const plural = (n: string | number | undefined, one: string, many: string) => (Number(n) === 1 ? one : many);

const en = {
  'app.title': 'RAG Assistant',
  'app.tagline': 'Query your documents, get cited answers.',
  'lang.switch': 'Language',

  'sidebar.demoTitle': 'Demo mode',
  'sidebar.demoBody': 'preloaded read-only corpus. Ask your questions in the conversation.',
  'sidebar.uploading': 'Uploading…',
  'sidebar.addPdfs': 'Add PDFs',
  'sidebar.dropHint': 'Click or drag and drop',
  'sidebar.documents': 'Documents',
  'sidebar.empty': 'No documents indexed yet.',
  'sidebar.openPdf': 'Open the PDF',
  'sidebar.delete': 'Delete',
  'sidebar.deleteFailed': 'Delete (then upload the file again to retry)',
  'sidebar.confirmDelete': (p) => `Delete "${p['name']}" and its index?`,
  'sidebar.indexing': 'Indexing…',
  'sidebar.indexFailed': 'Indexing failed.',
  'sidebar.pages': (p) => `${p['n']} ${plural(p['n'], 'page', 'pages')}`,
  'sidebar.passages': (p) => `${p['n']} ${plural(p['n'], 'passage', 'passages')}`,
  'sidebar.onlyPdf': (p) => `"${p['name']}": only PDF files are accepted.`,
  'sidebar.uploadFailed': 'upload failed.',
  'sidebar.deletionFailed': 'Deletion failed.',
  'sidebar.unreachable': 'Server unreachable. Run `npm run dev` in server/.',
  'sidebar.inScope': 'Include in the search',
  'sidebar.inScopeOf': (p) => `Search in "${p['name']}"`,
  'sidebar.selectAll': 'Select all',

  'chat.title': 'Conversation',
  'chat.indexed': (p) => `${p['n']} ${plural(p['n'], 'document', 'documents')} indexed`,
  'chat.scoped': (p) => `Searching ${p['n']} of ${p['total']} documents`,
  'chat.noScope': 'Select at least one document in the left panel to ask a question.',
  'chat.newConversation': 'New conversation',
  'chat.eyebrow': 'Document assistant',
  'chat.emptyTitle': 'Start by adding a document.',
  'chat.emptyBody': 'Drop a PDF in the left panel, then ask your questions: every answer cites the exact passages it relies on.',
  'chat.readyTitle': 'What would you like to know?',
  'chat.readyBody': 'Answers come only from your documents, with clickable citations to the source page.',
  'chat.disclaimer': 'Answers come only from your documents. Check the cited pages.',
  'chat.viewSource': (p) => `View source ${p['n']}`,
  'chat.placeholder': 'Ask your question…',
  'chat.stop': 'Stop',
  'chat.send': 'Send',
  'chat.unreachable': 'Could not reach the server.',
  'source.label': (p) => `Source [${p['n']}]`,
  'source.page': (p) => `Page ${p['n']}`,
  'source.open': (p) => `Open the PDF at page ${p['n']}`,
  'source.close': 'Close',

  // Server error codes (see server/src/errors.ts); unknown codes fall back to the server's English message.
  'error.rate_limited': (p) => `Too many requests: try again in ${p['seconds']} s.`,
  'error.invalid_request': 'Invalid request.',
  'error.internal': 'Internal server error.',
  'error.route_not_found': 'Route not found.',
  'error.no_question': 'The conversation must end with a question.',
  'error.question_too_long': (p) => `Question too long (maximum ${p['max']} characters).`,
  'error.no_documents': 'No documents indexed. Add at least one PDF before asking a question.',
  'error.no_documents_in_scope': 'None of the selected documents is ready. Select at least one indexed document.',
  'error.api_key_missing':
    'Anthropic API key not configured: copy server/.env.example to server/.env and set ANTHROPIC_API_KEY.',
  'error.api_key_invalid': 'Anthropic API key missing or invalid (ANTHROPIC_API_KEY in server/.env).',
  'error.llm_rate_limited': 'API rate limit reached, try again in a moment.',
  'error.llm_error': (p) => `LLM API error (${p['status']}).`,
  'error.aborted': 'Generation stopped.',
  'error.demo_read_only': 'Demo mode: the corpus is read-only.',
  'error.no_file': 'No file received.',
  'error.file_too_large': (p) => `File too large (maximum ${p['maxMb']} MB).`,
  'error.not_pdf': 'This file is not a valid PDF.',
  'error.already_indexed': (p) => `This document is already indexed ("${p['name']}").`,
  'error.not_found': 'Document not found.',
  'error.too_many_pages': (p) => `Document too long: ${p['pages']} pages (maximum ${p['max']}).`,
  'error.no_text': 'No usable text in this PDF (scanned document? OCR would be required).',
  'error.pdf_password': 'Password-protected PDF: remove the protection and try again.',
  'error.pdf_corrupt': 'Corrupt or unreadable PDF.',
  'error.indexing_failed': 'Indexing failed (internal error).',
} satisfies Record<string, Entry>;

export type I18nKey = keyof typeof en;

const fr: Record<I18nKey, Entry> = {
  'app.title': 'Assistant RAG',
  'app.tagline': 'Interrogez vos documents, obtenez des réponses sourcées.',
  'lang.switch': 'Langue',

  'sidebar.demoTitle': 'Mode démo',
  'sidebar.demoBody': 'corpus préchargé en lecture seule. Posez vos questions dans la conversation.',
  'sidebar.uploading': 'Envoi en cours…',
  'sidebar.addPdfs': 'Ajouter des PDF',
  'sidebar.dropHint': 'Cliquez ou glissez-déposez',
  'sidebar.documents': 'Documents',
  'sidebar.empty': 'Aucun document indexé pour le moment.',
  'sidebar.openPdf': 'Ouvrir le PDF',
  'sidebar.delete': 'Supprimer',
  'sidebar.deleteFailed': 'Supprimer (puis renvoyer le fichier pour réessayer)',
  'sidebar.confirmDelete': (p) => `Supprimer « ${p['name']} » et son index ?`,
  'sidebar.indexing': 'Indexation…',
  'sidebar.indexFailed': "Échec de l'indexation.",
  'sidebar.pages': (p) => `${p['n']} ${plural(p['n'], 'page', 'pages')}`,
  'sidebar.passages': (p) => `${p['n']} ${plural(p['n'], 'passage', 'passages')}`,
  'sidebar.onlyPdf': (p) => `« ${p['name']} » : seuls les fichiers PDF sont acceptés.`,
  'sidebar.uploadFailed': "échec de l'envoi.",
  'sidebar.deletionFailed': 'Échec de la suppression.',
  'sidebar.unreachable': 'Serveur injoignable. Lancez `npm run dev` dans server/.',
  'sidebar.inScope': 'Inclure dans la recherche',
  'sidebar.inScopeOf': (p) => `Rechercher dans « ${p['name']} »`,
  'sidebar.selectAll': 'Tout sélectionner',

  'chat.title': 'Conversation',
  'chat.indexed': (p) => `${p['n']} ${plural(p['n'], 'document indexé', 'documents indexés')}`,
  'chat.scoped': (p) => `Recherche dans ${p['n']} document${Number(p['n']) > 1 ? 's' : ''} sur ${p['total']}`,
  'chat.noScope': 'Sélectionnez au moins un document dans le panneau de gauche pour poser une question.',
  'chat.newConversation': 'Nouvelle conversation',
  'chat.eyebrow': 'Assistant documentaire',
  'chat.emptyTitle': 'Commencez par ajouter un document.',
  'chat.emptyBody':
    'Déposez un PDF dans le panneau de gauche, puis posez vos questions : chaque réponse cite les passages exacts sur lesquels elle s’appuie.',
  'chat.readyTitle': 'Que voulez-vous savoir ?',
  'chat.readyBody': 'Les réponses proviennent uniquement de vos documents, avec des citations cliquables vers la page source.',
  'chat.disclaimer': 'Les réponses proviennent uniquement de vos documents. Vérifiez les pages citées.',
  'chat.viewSource': (p) => `Voir la source ${p['n']}`,
  'chat.placeholder': 'Posez votre question…',
  'chat.stop': 'Arrêter',
  'chat.send': 'Envoyer',
  'chat.unreachable': 'Impossible de joindre le serveur.',
  'source.label': (p) => `Source [${p['n']}]`,
  'source.page': (p) => `Page ${p['n']}`,
  'source.open': (p) => `Ouvrir le PDF à la page ${p['n']}`,
  'source.close': 'Fermer',

  'error.rate_limited': (p) => `Trop de requêtes : réessayez dans ${p['seconds']} s.`,
  'error.invalid_request': 'Requête invalide.',
  'error.internal': 'Erreur interne du serveur.',
  'error.route_not_found': 'Route introuvable.',
  'error.no_question': 'La conversation doit se terminer par une question.',
  'error.question_too_long': (p) => `Question trop longue (${p['max']} caractères maximum).`,
  'error.no_documents': 'Aucun document indexé. Ajoutez au moins un PDF avant de poser une question.',
  'error.no_documents_in_scope': "Aucun des documents sélectionnés n'est prêt. Sélectionnez au moins un document indexé.",
  'error.api_key_missing':
    'Clé API Anthropic non configurée : copiez server/.env.example vers server/.env et renseignez ANTHROPIC_API_KEY.',
  'error.api_key_invalid': 'Clé API Anthropic absente ou invalide (ANTHROPIC_API_KEY dans server/.env).',
  'error.llm_rate_limited': "Limite de débit de l'API atteinte, réessayez dans un instant.",
  'error.llm_error': (p) => `Erreur de l'API LLM (${p['status']}).`,
  'error.aborted': 'Génération interrompue.',
  'error.demo_read_only': 'Mode démo : le corpus est en lecture seule.',
  'error.no_file': 'Aucun fichier reçu.',
  'error.file_too_large': (p) => `Fichier trop volumineux (${p['maxMb']} Mo maximum).`,
  'error.not_pdf': "Ce fichier n'est pas un PDF valide.",
  'error.already_indexed': (p) => `Ce document est déjà indexé (« ${p['name']} »).`,
  'error.not_found': 'Document introuvable.',
  'error.too_many_pages': (p) => `Document trop long : ${p['pages']} pages (${p['max']} maximum).`,
  'error.no_text': 'Aucun texte exploitable dans ce PDF (document scanné ? Une OCR serait nécessaire).',
  'error.pdf_password': 'PDF protégé par mot de passe : retirez la protection et réessayez.',
  'error.pdf_corrupt': 'PDF corrompu ou illisible.',
  'error.indexing_failed': "Échec de l'indexation (erreur interne).",
};

const dictionaries: Record<Lang, Record<I18nKey, Entry>> = { en, fr };
const STORAGE_KEY = 'lang';

/** Runtime UI translation: one build, language switchable without reload. */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(initialLang());

  constructor() {
    const doc = inject(DOCUMENT);
    effect(() => {
      const lang = this.lang();
      doc.documentElement.lang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // Storage blocked (private mode): the choice just won't survive a reload.
      }
    });
  }

  /** Reads `lang()`, so templates and computeds re-render on switch. */
  t(key: I18nKey, params: Params = {}): string {
    const entry = dictionaries[this.lang()][key];
    return typeof entry === 'function' ? entry(params) : entry;
  }

  /** Translates a server error code, falling back to the server's English message. */
  error(code: string | undefined, params: Params | undefined, fallback: string): string {
    const key = `error.${code}`;
    return key in en ? this.t(key as I18nKey, params) : fallback;
  }
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // Fall through to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
