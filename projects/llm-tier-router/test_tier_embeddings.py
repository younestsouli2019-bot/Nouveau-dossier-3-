# =============================================================================
# Test del Classificatore di Tier  (VERSIONE EMBEDDING)
# Carica tier_clf_embed.joblib { "model_name", "clf" }, ricarica l'encoder
# transformer e classifica frasi (economy vs premium) sul SIGNIFICATO.
#
# Uso:
#   python test_tier_embeddings.py                 -> interattivo (scrivi frasi)
#   python test_tier_embeddings.py "una frase"     -> classifica una frase
#   python test_tier_embeddings.py -f frasi.txt    -> una frase per riga
# =============================================================================

import os
# transformers non deve importare TensorFlow (qui rotto). Solo-PyTorch.
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

import sys
import joblib

MODEL_PATH = "tier_clf_embed.joblib"
THRESHOLD = 0.50   # abbassa (es. 0.35) per essere più prudente -> più premium


def load():
    if not os.path.exists(MODEL_PATH):
        sys.exit(f"[errore] {MODEL_PATH} non trovato — allena prima con train_tier_embeddings.py")
    bundle = joblib.load(MODEL_PATH)
    clf = bundle["clf"]
    model_name = bundle["model_name"]

    from sentence_transformers import SentenceTransformer
    print(f"[info] carico encoder: {model_name} ...")
    encoder = SentenceTransformer(model_name)
    return encoder, clf


def classify(encoder, clf, text: str):
    v = encoder.encode([text], convert_to_numpy=True)
    p = float(clf.predict_proba(v)[0][1])
    tier = "PREMIUM" if p >= THRESHOLD else "economy"
    return tier, p


def show(encoder, clf, text: str):
    tier, p = classify(encoder, clf, text)
    bar = "#" * int(p * 20)
    print(f"  [{tier:7}]  p_premium={p:.2f} |{bar:<20}|  {text}")


def main():
    encoder, clf = load()
    args = sys.argv[1:]

    if args and args[0] == "-f":
        if len(args) < 2:
            sys.exit("[errore] uso: -f <file.txt>")
        with open(args[1], encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    show(encoder, clf, line)
        return

    if args:
        show(encoder, clf, " ".join(args))
        return

    print(f"\nModello embedding  |  soglia premium >= {THRESHOLD}")
    print("Scrivi una frase e premi Invio. (vuoto o Ctrl+C per uscire)\n")
    try:
        while True:
            text = input("> ").strip()
            if not text:
                break
            show(encoder, clf, text)
    except (KeyboardInterrupt, EOFError):
        print()


if __name__ == "__main__":
    main()
