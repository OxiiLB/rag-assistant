# Assistant RAG multi-documents avec citations

Posez des questions sur vos PDF : l'assistant répond en streaming en citant le document et la page exacts, avec citations cliquables ouvrant le passage source.

## Fonctionnalités

- **Ingestion multi-documents** — upload PDF (clic ou glisser-déposer), extraction du texte page par page, découpage en chunks avec chevauchement.
- **Recherche hybride** — embeddings multilingues calculés localement (`multilingual-e5-small` via transformers.js, gratuit et hors-ligne) **fusionnés avec un index BM25** par Reciprocal Rank Fusion.
- **Chunks contextualisés** — chaque extrait embarque son ascendance (`document › titre de page › section`), pour rester trouvable même coupé au milieu d'une section.
- **Réponses citées** — le LLM (Claude Sonnet 5) s'appuie exclusivement sur les passages récupérés et cite ses sources `[n]`.
- **Streaming token par token** — la réponse s'affiche au fil de l'eau (SSE), avec bouton Stop.
- **Historique multi-tours** — la conversation garde le contexte des échanges précédents.
- **Citations cliquables** — chaque `[n]` ouvre un panneau montrant l'extrait exact, sa page et sa pertinence, avec lien vers le PDF ouvert à la bonne page.

## Stack

| Couche | Techno |
|---|---|
| Frontend | Angular 21 (signals, standalone) + Tailwind CSS 4 |
| Backend | Node.js + Fastify 5 (TypeScript, tsx) |
| LLM | Claude Sonnet 5 (`@anthropic-ai/sdk`, streaming + prompt caching) |
| Embeddings | `Xenova/multilingual-e5-small` en local via `@huggingface/transformers` |
| Vector store | Store local (fichier + cosinus en mémoire) par défaut, **Qdrant** en option via `QDRANT_URL` |

### Pourquoi une recherche hybride

Sur un corpus homogène (trois fiches au vocabulaire proche), `multilingual-e5-small` place tous
les passages entre 0,81 et 0,88 de similarité : le classement devient du bruit, et une question
nommant une section précise (« les fonctionnalités **Must** ») ne fait pas remonter cette section.
BM25 retrouve exactement ces termes rares. Les deux classements sont fusionnés par RRF, qui ne
compare que des rangs — donc aucune calibration entre deux échelles de score incomparables.

## Démarrage

### 1. Backend

```bash
cd server
npm install
cp .env.example .env   # puis renseigner ANTHROPIC_API_KEY
npm run dev            # http://localhost:3000
```

Au premier lancement, le modèle d'embeddings (~100 Mo) est téléchargé puis mis en cache.

### 2. Frontend

```bash
cd web
npm install
npm start              # http://localhost:4200 (proxy /api → :3000)
```

### 3. Qdrant (optionnel)

Par défaut les vecteurs sont stockés dans `server/data/vectors.json` — suffisant pour une démo.
Pour utiliser Qdrant :

```bash
docker compose up -d
```

puis décommenter `QDRANT_URL=http://localhost:6333` dans `server/.env`.

## Architecture

```
server/src/
  server.ts              # bootstrap Fastify (CORS, multipart, routes)
  routes/documents.ts    # upload/parse/index, liste, suppression, PDF source
  routes/chat.ts         # POST /api/chat — flux SSE (sources, delta, done, error)
  services/pdf.ts        # extraction texte par page (unpdf), recollage des mots coupés
  services/chunking.ts   # découpage ~1000 caractères + détection des sections
  services/embeddings.ts # pipeline transformers.js (préfixes E5 query/passage)
  services/lexical.ts    # index BM25 (mots-clés exacts)
  services/vector-store.ts # abstraction VectorStore : local ou Qdrant
  services/rag.ts        # fusion RRF dense+BM25, prompt cité, streaming Claude
web/src/app/
  components/sidebar/    # upload + gestion des documents
  components/chat/       # conversation, streaming, citations, panneau source
  chat.service.ts        # client SSE (fetch + ReadableStream)
  api.service.ts         # CRUD documents
```

## API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/documents` | Upload + indexation d'un PDF (multipart) |
| `GET` | `/api/documents` | Liste des documents indexés |
| `DELETE` | `/api/documents/:id` | Supprime le document et ses vecteurs |
| `GET` | `/api/documents/:id/file` | PDF original (`#page=N` pour la citation) |
| `POST` | `/api/chat` | `{ messages: [...] }` → flux SSE de la réponse citée |
