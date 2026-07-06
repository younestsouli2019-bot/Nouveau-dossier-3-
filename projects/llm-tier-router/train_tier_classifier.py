# =============================================================================
# Classificatore di Tier — Caro
# Training script per Kaggle (CPU, nessun TensorFlow).
#
# Input : tier_dataset.jsonl  -> {"text": "...", "label": 0|1}   (1=premium, 0=economy)
# Output: tier_clf.joblib      -> Pipeline sklearn (TF-IDF -> classificatore)
#
# Uso su Kaggle:
#   1) Carica tier_dataset.jsonl come Dataset (Add Data) oppure incollalo in /kaggle/working
#   2) Esegui questo notebook
#   3) Scarica tier_clf.joblib da Output
# =============================================================================

import json
import os
import glob

from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import joblib

# --------------------------------------------------------------------------- #
# CONFIG
# --------------------------------------------------------------------------- #
# Modello: "logreg" (default, veloce, di solito basta) oppure "mlp" (rete densa ReLU)
MODEL_KIND = "logreg"

# Path dove cercare il dataset. Su Kaggle i dataset stanno in /kaggle/input/<nome>/
# Accetta sia JSONL (una riga = un oggetto) sia JSON (array di oggetti).
DATASET_CANDIDATES = [
    "tier_dataset.jsonl",
    "tier_dataset.json",
    "/kaggle/working/tier_dataset.jsonl",
    "/kaggle/working/tier_dataset.json",
    "/kaggle/input/**/tier_dataset.jsonl",
    "/kaggle/input/**/tier_dataset.json",
]

# Dove salvare il modello. Su Kaggle /kaggle/working finisce negli Output scaricabili.
OUTPUT_PATH = "/kaggle/working/tier_clf.joblib" if os.path.isdir("/kaggle/working") else "tier_clf.joblib"

RANDOM_STATE = 42
TEST_SIZE = 0.2

# --------------------------------------------------------------------------- #
# 1. CARICAMENTO DATASET
# --------------------------------------------------------------------------- #
def find_dataset() -> str | None:
    for pattern in DATASET_CANDIDATES:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            return matches[0]
    return None


def _clean(rows_in):
    """Filtra oggetti validi (text + label) da una lista."""
    rows = []
    for i, obj in enumerate(rows_in, 1):
        if not isinstance(obj, dict) or "text" not in obj or "label" not in obj:
            print(f"[warn] esempio {i} scartato (manca text/label)")
            continue
        rows.append({"text": str(obj["text"]), "label": int(obj["label"])})
    return rows


def load_dataset(path: str):
    """Carica JSONL (una riga = un oggetto) oppure JSON (array di oggetti)."""
    with open(path, encoding="utf-8") as f:
        content = f.read().strip()

    # JSON array: inizia con '['
    if content.startswith("["):
        return _clean(json.loads(content))

    # altrimenti JSONL: un oggetto per riga
    objs = []
    for i, line in enumerate(content.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            objs.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"[warn] riga {i} scartata (JSON non valido): {e}")
    return _clean(objs)


# Piccolo dataset seed: serve solo perché lo script giri anche senza file caricato.
# SOSTITUISCILO col tuo tier_dataset.jsonl vero: pochi esempi = modello inutile.
SEED_ROWS = [
    # economy (0)
    {"text": "ciao", "label": 0},
    {"text": "ok grazie", "label": 0},
    {"text": "che ore sono a tokyo?", "label": 0},
    {"text": "capitale della francia?", "label": 0},
    {"text": "quanto fa 12 per 8?", "label": 0},
    {"text": "come stai?", "label": 0},
    {"text": "buongiorno", "label": 0},
    {"text": "traduci 'cane' in inglese", "label": 0},
    {"text": "che giorno è oggi?", "label": 0},
    {"text": "perfetto, chiudi pure", "label": 0},
    # premium (1)
    {"text": "cerca le ultime notizie sul rame e fammi un pdf", "label": 1},
    {"text": "analizza queste 3 email e proponimi 3 risposte diverse", "label": 1},
    {"text": "riassumimi le ultime email e preparami una risposta al capo", "label": 1},
    {"text": "cerca voli per lisbona e poi mettili in calendario", "label": 1},
    {"text": "scrivimi una mail formale di scuse al cliente in stile professionale", "label": 1},
    {"text": "confronta questi due contratti e dimmi le differenze rischiose", "label": 1},
    {"text": "pianifica un viaggio di 5 giorni a roma con budget e tappe", "label": 1},
    {"text": "leggi il file e generami un report con grafici", "label": 1},
    {"text": "trova i bug in questo codice e proponi una fix", "label": 1},
    {"text": "fai una ricerca web e scrivi un articolo di 500 parole", "label": 1},
]

path = find_dataset()
if path:
    print(f"[ok] dataset trovato: {path}")
    rows = load_dataset(path)
else:
    print("[warn] tier_dataset.jsonl NON trovato — uso il dataset SEED (solo demo).")
    rows = SEED_ROWS

if len(rows) < 8:
    print(f"[warn] solo {len(rows)} esempi: troppo pochi per un modello serio.")

texts = [r["text"] for r in rows]
labels = [r["label"] for r in rows]

n_pos = sum(labels)
n_neg = len(labels) - n_pos
print(f"[info] esempi: {len(labels)}  |  premium(1)={n_pos}  economy(0)={n_neg}")

# --------------------------------------------------------------------------- #
# 2. SPLIT TRAIN/TEST
# --------------------------------------------------------------------------- #
# stratify tiene le proporzioni 0/1; disattivalo se una classe ha < 2 esempi
can_stratify = n_pos >= 2 and n_neg >= 2
X_train, X_test, y_train, y_test = train_test_split(
    texts, labels,
    test_size=TEST_SIZE,
    random_state=RANDOM_STATE,
    stratify=labels if can_stratify else None,
)

# --------------------------------------------------------------------------- #
# 3. PIPELINE (testo -> vettore TF-IDF -> classificatore)
# --------------------------------------------------------------------------- #
if MODEL_KIND == "mlp":
    net = MLPClassifier(
        hidden_layer_sizes=(64, 32),
        activation="relu",
        alpha=1e-3,             # L2 (regolarizzazione, sostituisce il dropout)
        early_stopping=True,
        max_iter=500,
        random_state=RANDOM_STATE,
    )
else:
    net = LogisticRegression(max_iter=1000, class_weight="balanced")

clf = Pipeline([
    ("tfidf", TfidfVectorizer(max_features=20000, ngram_range=(1, 2))),
    ("net", net),
])

print(f"[info] training modello: {MODEL_KIND} ...")
clf.fit(X_train, y_train)

# --------------------------------------------------------------------------- #
# 4. VALUTAZIONE
# --------------------------------------------------------------------------- #
if X_test:
    y_pred = clf.predict(X_test)
    print("\n=== Classification report (test) ===")
    print(classification_report(y_test, y_pred, target_names=["economy(0)", "premium(1)"], zero_division=0))
    print("=== Confusion matrix (righe=vero, col=pred) ===")
    print(confusion_matrix(y_test, y_pred))

# Prova rapida su frasi nuove
print("\n=== Demo predizioni ===")
demo = [
    "ciao come va",
    "cerca sul web e scrivimi un riassunto in pdf",
    "che ore sono?",
    "analizza il bilancio e proponi 3 azioni",
]
for t in demo:
    label = int(clf.predict([t])[0])
    tier = "PREMIUM" if label == 1 else "economy"
    prob = ""
    if hasattr(clf, "predict_proba"):
        p = clf.predict_proba([t])[0][1]
        prob = f"  (p_premium={p:.2f})"
    print(f"  [{tier:7}] {t}{prob}")

# --------------------------------------------------------------------------- #
# 5. SALVATAGGIO ARTEFATTO
# --------------------------------------------------------------------------- #
# Riaddestra su TUTTI i dati prima di salvare (usa anche il test set)
clf.fit(texts, labels)
joblib.dump(clf, OUTPUT_PATH)
print(f"\n[ok] modello salvato: {OUTPUT_PATH}")
print("     -> scaricalo e mettilo in backend/models/tier_clf.joblib")
