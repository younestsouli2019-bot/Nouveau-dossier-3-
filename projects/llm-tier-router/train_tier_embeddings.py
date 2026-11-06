# =============================================================================
# Classificatore di Tier  (VERSIONE EMBEDDING SEMANTICI)
# Alternativa a train_tier_classifier.py (che usa TF-IDF).
#
# Differenza chiave:
#   TF-IDF     : conta parole            -> non capisce sinonimi/contesto
#   Embedding  : transformer pre-addestrato trasforma la frase in un vettore
#                che cattura il SIGNIFICATO -> sinonimi/contesto/menzioni
#
# NON si addestra il transformer da zero: si SCARICA già pronto (HuggingFace)
# e si allena sopra solo un piccolo LogisticRegression. Stesso split del TF-IDF
# (random_state=42, test_size=0.2) così il confronto è onesto.
#
# Dipendenze (pesanti):  pip install sentence-transformers
#   (tira dentro torch ~ qualche centinaio di MB; il modello ~118MB al primo run)
#
# Output: tier_clf_embed.joblib  = { "model_name": ..., "clf": LogisticRegression }
# =============================================================================

import os
# Evita che HuggingFace transformers importi TensorFlow (qui rotto per protobuf).
# Forza backend solo-PyTorch. DEVE stare prima di importare sentence_transformers.
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

import json
import glob
import time

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import joblib

# --------------------------------------------------------------------------- #
# CONFIG  (identica al TF-IDF dove conta, per confronto onesto)
# --------------------------------------------------------------------------- #
# Encoder pre-addestrato multilingua (IT+EN+FR). Piccolo e veloce.
# Alternativa più forte: "intfloat/multilingual-e5-small"
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

DATASET_CANDIDATES = [
    "tier_dataset.jsonl", "tier_dataset.json",
    "/kaggle/working/tier_dataset.jsonl", "/kaggle/working/tier_dataset.json",
    "/kaggle/input/**/tier_dataset.jsonl", "/kaggle/input/**/tier_dataset.json",
]
OUTPUT_PATH = "/kaggle/working/tier_clf_embed.joblib" if os.path.isdir("/kaggle/working") else "tier_clf_embed.joblib"
EMB_CACHE = "embeddings_cache.npy"   # salva i vettori: al 2° run non ricalcola

RANDOM_STATE = 42
TEST_SIZE = 0.2

# --------------------------------------------------------------------------- #
# 1. DATASET  (stesso loader del TF-IDF: JSON array o JSONL)
# --------------------------------------------------------------------------- #
def find_dataset():
    for pattern in DATASET_CANDIDATES:
        m = glob.glob(pattern, recursive=True)
        if m:
            return m[0]
    return None


def load_dataset(path):
    with open(path, encoding="utf-8") as f:
        content = f.read().strip()
    if content.startswith("["):
        objs = json.loads(content)
    else:
        objs = [json.loads(l) for l in content.splitlines() if l.strip()]
    rows = []
    for o in objs:
        if isinstance(o, dict) and "text" in o and "label" in o:
            rows.append({"text": str(o["text"]), "label": int(o["label"])})
    return rows


path = find_dataset()
if not path:
    raise SystemExit("[errore] tier_dataset.json/.jsonl non trovato")
print(f"[ok] dataset: {path}")
rows = load_dataset(path)
texts = [r["text"] for r in rows]
labels = [r["label"] for r in rows]
print(f"[info] esempi: {len(labels)}  premium={sum(labels)}  economy={len(labels)-sum(labels)}")

# --------------------------------------------------------------------------- #
# 2. EMBEDDING  (transformer pre-addestrato: testo -> vettore 384-dim)
# --------------------------------------------------------------------------- #
# Cache: se esiste ed è coerente col dataset, riusa (encoding è la parte lenta)
if os.path.exists(EMB_CACHE):
    X = np.load(EMB_CACHE)
    if X.shape[0] != len(texts):
        print("[warn] cache non coerente, ricalcolo")
        X = None
    else:
        print(f"[ok] embedding caricati da cache: {X.shape}")
else:
    X = None

if X is None:
    from sentence_transformers import SentenceTransformer
    print(f"[info] carico encoder: {EMBED_MODEL}")
    print("       (primo run: scarica ~118MB, poi resta in cache locale)")
    encoder = SentenceTransformer(EMBED_MODEL)
    print("[info] calcolo embedding di tutte le frasi ...")
    t = time.time()
    X = encoder.encode(texts, batch_size=64, show_progress_bar=True, convert_to_numpy=True)
    print(f"[ok] embedding calcolati: {X.shape}  in {time.time()-t:.1f}s")
    np.save(EMB_CACHE, X)
    print(f"[ok] salvati in {EMB_CACHE} (prossimo run è istantaneo)")

y = np.array(labels)

# --------------------------------------------------------------------------- #
# 3. SPLIT + TRAINING  (LogReg sopra gli embedding — stesso split del TF-IDF)
# --------------------------------------------------------------------------- #
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y,
)

clf = LogisticRegression(max_iter=1000, class_weight="balanced")
t = time.time()
clf.fit(X_train, y_train)
print(f"\n[info] training LogReg su embedding: {time.time()-t:.3f}s")

# --------------------------------------------------------------------------- #
# 4. VALUTAZIONE
# --------------------------------------------------------------------------- #
y_pred = clf.predict(X_test)
print("\n=== Classification report (test) ===")
print(classification_report(y_test, y_pred, target_names=["economy(0)", "premium(1)"], zero_division=0))
print("=== Confusion matrix (righe=vero, col=pred) ===")
print(confusion_matrix(y_test, y_pred))

# --------------------------------------------------------------------------- #
# 5. TEST TRABOCCHETTI  (gli stessi casi dove il TF-IDF sbagliava)
# --------------------------------------------------------------------------- #
print("\n=== Trabocchetti (menzione vs comando) ===")
traps = [
    "ciao",
    "genera un file",
    "riscrivi la parola domani",
    "riscrivi la parola genera",       # TF-IDF cascava: premium per la parola 'genera'
    "cosa significa analizza",         # menzione, non comando -> dovrebbe essere economy
    "cerca voli per parigi e mettili in calendario",
]
from sentence_transformers import SentenceTransformer
enc = SentenceTransformer(EMBED_MODEL)
for t_ in traps:
    v = enc.encode([t_], convert_to_numpy=True)
    p = float(clf.predict_proba(v)[0][1])
    tier = "PREMIUM" if p >= 0.5 else "economy"
    print(f"  [{tier:7}] p={p:.2f}  {t_}")

# --------------------------------------------------------------------------- #
# 6. SALVATAGGIO  (riallena su TUTTO prima di salvare)
# --------------------------------------------------------------------------- #
clf.fit(X, y)
joblib.dump({"model_name": EMBED_MODEL, "clf": clf}, OUTPUT_PATH)
print(f"\n[ok] salvato: {OUTPUT_PATH}")
print("     nota: all'inferenza serve ricaricare l'encoder + questo clf")
