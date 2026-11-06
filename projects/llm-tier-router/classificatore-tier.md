# Classificatore di Tier

Documento di design condiviso. Obiettivo: decidere insieme idea, librerie, struttura e
**formato dei dati** prima di scrivere codice.

---

## 1. L'idea

Oggi ogni messaggio in chat gira sul modello **premium** (Sonnet / qwen3-coder), fisso nel
codice. Consuma troppo. Se però usassimo sempre l'**economy** (Haiku / gpt-oss), sui compiti
complessi la qualità crollerebbe.

**Soluzione:** un piccolo **classificatore** che, per ogni turno dell'utente, decide da solo
quale tier usare:

- `economy` → domande semplici, saluti, richieste secche, un solo passo.
- `premium` → ragionamento, più passaggi, uso di strumenti, scrittura/analisi.

Così spendi il modello costoso **solo quando serve davvero**, senza rinunciare alla qualità.

---

## 2. Il problema in una riga

Massimizzare qualità **per** costo: instradare al modello giusto ogni richiesta, in modo
automatico, veloce (< qualche ms) e sicuro (in caso di dubbio → premium, mai degradare in
silenzio).

---

## 3. Le librerie

Niente TensorFlow (troppo pesante per un classificatore binario di testo). Stack leggero:

| Libreria | Ruolo | Perché |
|---|---|---|
| **scikit-learn** | vettorizzazione (`TfidfVectorizer`) + modello (`LogisticRegression` o `MLPClassifier`) | leggera, CPU, import veloce, un solo file |
| **joblib** | salvataggio/caricamento del modello (`.joblib`) | standard sklearn, un file self-contained |
| **numpy** | già presente | matematica di base |

- **Modello di partenza:** `LogisticRegression` su TF-IDF. Semplice, addestra in un secondo,
  di solito basta per economy-vs-premium.
- **Se serve più capacità:** `MLPClassifier(hidden_layer_sizes=(64,32), activation="relu")`
  — rete densa con ReLU già pronta in sklearn. Regolarizzazione con `alpha` (L2) +
  `early_stopping=True` (in sklearn non c'è il dropout).
- **Installazione:** `cd backend && uv add scikit-learn` (tracciato in `pyproject.toml`).

L'intera pipeline (testo → vettore → 0/1) sta in **un unico `Pipeline` sklearn**, salvato come
**un file `.joblib`**.

---

## 4. Struttura d'insieme (come si innesta nel backend)

Il backend ha già un sistema di tier: `ModelTier.ECONOMY | PREMIUM` in
`backend/src/app/privacy_router/client.py`. La chat lo usa nel loop ReAct in
`backend/src/app/orchestrator/graph.py` (oggi hardcoded a `PREMIUM`).

Innesto previsto (dietro un flag, così è spegnibile):

```
utente → graph.py (react_loop)
             │
             ├─ classify_tier(messaggio)        ← NUOVO modulo
             │      └─ carica tier_clf.joblib (singleton) → predice 0/1
             │
             └─ privacy_router.chat_with_tools(tier=<scelto>)
```

Componenti da aggiungere:

1. **`backend/src/app/privacy_router/tier_classifier.py`** — funzione `classify_tier(text) -> ModelTier`:
   - carica il modello una sola volta (singleton, `functools.lru_cache`);
   - `import joblib` **lazy** (dentro la funzione) così è dipendenza opzionale;
   - predizione in `asyncio.to_thread` (non blocca l'event loop);
   - **fail-safe → PREMIUM** su qualsiasi errore.
2. **`config.py`** — due voci: `dynamic_tier_enabled` (flag `DYNAMIC_TIER`, default `false`) e
   `tier_model_path` (default `models/tier_clf.joblib`).
3. **`graph.py`** — calcola il tier una volta prima del loop e lo passa al posto del `PREMIUM` fisso.
4. **`backend/models/tier_clf.joblib`** — il file del modello addestrato.

Nota: la logica economy/premium è **cablata nel codice** per task; questo classificatore
cambia solo la scelta per la **chat interattiva**. I job di background restano com'erano.

---

## 5. Il modello (training — a cura tua)

Flusso tipico:

```python
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import joblib

clf = Pipeline([
    ("tfidf", TfidfVectorizer(max_features=20000, ngram_range=(1,2))),
    ("net",   LogisticRegression(max_iter=1000)),   # o MLPClassifier(...)
])
clf.fit(texts, labels)          # texts: list[str], labels: list[int] (0/1)
joblib.dump(clf, "tier_clf.joblib")
```

Il file `tier_clf.joblib` è l'unico artefatto che serve al backend.

---

## 6. Formato dati JSON

Dataset in **JSONL** — un oggetto JSON per riga (`.jsonl`). Si appende senza riscrivere tutto
e si legge riga per riga.

Schema **minimale**: solo i due campi che servono davvero per addestrare.

### Schema di un esempio

```json
{ "text": "riassumimi le ultime email e preparami una risposta al capo", "label": 1 }
```

### Campi

| Campo | Tipo | Significato |
|---|---|---|
| `text` | string | il messaggio dell'utente (input) |
| `label` | int (0/1) | target: **1 = premium**, **0 = economy** |

Nient'altro. (Un `id` si aggiunge solo se in futuro servirà deduplicare o rimuovere un
esempio specifico; ora non serve.)

### Esempio di file `tier_dataset.jsonl`

```jsonl
{"text":"ciao","label":0}
{"text":"che ore sono a tokyo?","label":0}
{"text":"cerca le ultime notizie sul rame e fammi un pdf","label":1}
{"text":"analizza queste 3 email e proponimi 3 risposte diverse","label":1}
```

### Caricamento in training

```python
import json
rows = [json.loads(l) for l in open("tier_dataset.jsonl", encoding="utf-8")]
texts  = [r["text"]  for r in rows]
labels = [r["label"] for r in rows]
```

---

## 7. Convenzione label + linee guida per etichettare

**`1 = premium`** (serve il modello grosso) · **`0 = economy`** (basta il piccolo).

Etichetta `economy` (0) quando il messaggio è:
- saluto / chiacchiera / conferma ("ciao", "ok", "grazie");
- domanda fattuale secca a un passo ("che ore sono?", "capitale della Francia?");
- richiesta breve senza strumenti né ragionamento multi-step.

Etichetta `premium` (1) quando il messaggio implica:
- più passaggi o pianificazione ("cerca X **e poi** fai Y");
- uso di strumenti (email, calendario, ricerca news/web, generazione file);
- scrittura/composizione (email, testi, riassunti "in stile");
- analisi, confronto, ragionamento, ambiguità da sciogliere.

**Regola d'oro:** nel dubbio → `1` (premium). Un economy sbagliato rovina la risposta; un
premium in più costa solo un po'.

---

## 8. Inferenza (runtime, nel backend)

```python
import joblib, functools, asyncio

@functools.lru_cache(maxsize=1)
def _load():
    import joblib                    # lazy
    return joblib.load(get_settings().tier_model_path)

async def classify_tier(text: str) -> ModelTier:
    if not get_settings().dynamic_tier_enabled:
        return ModelTier.PREMIUM
    try:
        clf = _load()
        label = await asyncio.to_thread(lambda: int(clf.predict([text])[0]))
        return ModelTier.PREMIUM if label == 1 else ModelTier.ECONOMY
    except Exception:
        return ModelTier.PREMIUM     # fail-safe
```

- caricamento **una volta** (singleton), predizione in **thread**, **fail-safe → premium**;
- se `predict_proba` disponibile, si può usare una **soglia** diversa da 0.5 per essere più
  prudenti (es. premium se `p >= 0.35`).

---

## 9. File e artefatti (riepilogo)

| Artefatto | Dove | Cosa |
|---|---|---|
| `tier_dataset.jsonl` | fuori dal repo (o `backend/data/`) | dataset di training (JSONL) |
| `tier_clf.joblib` | `backend/models/` | modello addestrato (un file) |
| `tier_classifier.py` | `backend/src/app/privacy_router/` | inferenza + fail-safe |
| voci in `config.py` | backend | flag `DYNAMIC_TIER` + path modello |
| modifica in `graph.py` | backend | usa il tier scelto nel loop ReAct |

---

## 10. Passi

1. **Concordare questo formato JSON** (sezione 6) — è il punto da decidere ora.
2. Raccogliere/etichettare i primi esempi (a mano + dai log del Privacy Router).
3. Addestrare → produrre `tier_clf.joblib`.
4. `uv add scikit-learn joblib`.
5. Aggiungere il seam `classify_tier` + flag + innesto in `graph.py` (dietro `DYNAMIC_TIER=false`).
6. Test A/B: accendere il flag, misurare % economy/premium, costo e qualità sui log.

---

*Bozza per discussione. Da rivedere insieme prima di implementare.*
