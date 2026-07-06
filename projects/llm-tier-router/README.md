# Classificatore di Tier

Piccolo **router** che, per ogni messaggio dell'utente, decide se serve il modello
**premium** (potente, costoso) o basta l'**economy** (leggero, veloce). Obiettivo:
massimizzare qualità **per** costo — usare il modello grosso solo quando serve davvero,
in pochi millisecondi, con logica **fail-safe** (nel dubbio → premium).

- `1 = premium` → uso di strumenti (email, calendario, web, file), scrittura/analisi,
  multi-step, codice, pianificazione, spiegazioni ad alto livello.
- `0 = economy` → saluti, chiacchiera, fatto secco a un passo, definizioni/menzioni di
  una parola, conversione/traduzione singola, spiegazioni semplici.

## Due approcci a confronto

| | File | Come funziona | Punto debole |
|---|---|---|---|
| **TF-IDF** | `train_tier_classifier.py` | conta parole/n-grammi + LogReg | non capisce sinonimi, contesto, altre lingue |
| **Embedding** | `train_tier_embeddings.py` | transformer multilingua → vettore di **significato** + LogReg | dipendenza più pesante (torch) |

L'embedding usa `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`: il
transformer è **pre-addestrato e congelato**, si allena solo un `LogisticRegression`
sopra i suoi vettori. Cattura il significato → generalizza a parafrasi, gergo e
**inglese** anche se il grosso del dataset è italiano.

## Risultati

Banco di prova `compare_models.py`: ~100 domande **fuori dal training** (IT + EN, dal
banale all'indiretto/trabocchetto), etichettate a mano.

| modello | successo globale | su generalizzazione |
|---|---|---|
| TF-IDF | ~87,2% | ~83% |
| **Embedding** | **~97,6%** | **~95%** |

L'embedding vince di ~12 punti e generalizza cross-lingua senza inglese dedicato nel
training. È la scelta giusta per questo caso d'uso.

## Dataset

`tier_dataset.json` — **12.130** esempi (6.200 premium / 5.930 economy), bilanciato,
formato minimale:

```json
{ "text": "riassumimi le ultime email e preparami una risposta al capo", "label": 1 }
```

## Uso

```bash
# training (produce i .joblib)
python train_tier_classifier.py     # TF-IDF  -> tier_clf.joblib
python train_tier_embeddings.py     # embedding -> tier_clf_embed.joblib
#   (primo run: scarica ~118MB di modello; l'encoding è cachato in embeddings_cache.npy)

# confronto sul banco di prova
python compare_models.py

# prova interattiva (scrivi una frase, vedi il tier + probabilità)
python test_tier_embeddings.py
python test_tier_classifier.py
```

Dipendenze: `scikit-learn`, `joblib`, `numpy` (per l'embedding anche
`sentence-transformers`, che tira `torch`).

## File

| File | Cosa |
|---|---|
| `classificatore-tier.md` | documento di design (idea, librerie, formato dati, innesto nel backend) |
| `tier_dataset.json` | dataset di training (JSON, IT + EN) |
| `train_tier_classifier.py` / `train_tier_embeddings.py` | training TF-IDF / embedding |
| `test_tier_classifier.py` / `test_tier_embeddings.py` | prova interattiva |
| `compare_models.py` | banco di confronto tra i due modelli |
| `tier_clf.joblib` / `tier_clf_embed.joblib` | modelli addestrati |

> `embeddings_cache.npy` non è versionato (cache rigenerabile, ~18MB): si ricrea al
> primo `train_tier_embeddings.py`.

## Stato e prossimi passi

Il modello è pronto per essere messo dietro il flag `DYNAMIC_TIER` e testato in A/B sui
log reali (vedi design doc, §10). Leve aperte per migliorare oltre il banco:

1. **Coerenza delle etichette** — una rubrica esplicita (serve tool? multi-step?
   scrittura/analisi? profondità?) vale più di altri dati.
2. **Banda d'incertezza** — se `p_premium` è vicino a 0.5, escalare a premium (fail-safe)
   o a un mini-giudice LLM invece di decidere secco.
3. **Encoder più forte** (`multilingual-e5`, `bge-m3`) per più margine semantico.
