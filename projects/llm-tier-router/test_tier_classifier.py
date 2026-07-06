# =============================================================================
# Test del Classificatore di Tier — Caro
# Carica tier_clf.joblib e classifica frasi (economy vs premium).
#
# Uso:
#   python test_tier_classifier.py                 -> modalità interattiva (scrivi frasi)
#   python test_tier_classifier.py "una frase"     -> classifica una frase e esci
#   python test_tier_classifier.py -f frasi.txt    -> classifica ogni riga del file
#
# Soglia: premium se p_premium >= THRESHOLD.
#   0.50 = neutra | < 0.50 = più prudente (più premium, come da design doc "nel dubbio premium")
# =============================================================================

import sys
import os
import joblib

MODEL_PATH = "tier_clf.joblib"
THRESHOLD = 0.50   # abbassa (es. 0.35) per essere più prudente -> più premium


def load_model(path: str):
    if not os.path.exists(path):
        sys.exit(f"[errore] modello non trovato: {path}\n"
                 f"         addestralo prima con train_tier_classifier.py")
    return joblib.load(path)


def classify(clf, text: str):
    """Ritorna (tier_str, p_premium|None)."""
    if hasattr(clf, "predict_proba"):
        p = float(clf.predict_proba([text])[0][1])
        tier = "PREMIUM" if p >= THRESHOLD else "economy"
        return tier, p
    label = int(clf.predict([text])[0])
    return ("PREMIUM" if label == 1 else "economy"), None


def show(clf, text: str):
    tier, p = classify(clf, text)
    if p is None:
        print(f"  [{tier:7}]  {text}")
    else:
        bar = "#" * int(p * 20)                      # barretta visiva 0..20
        print(f"  [{tier:7}]  p_premium={p:.2f} |{bar:<20}|  {text}")


def main():
    clf = load_model(MODEL_PATH)
    args = sys.argv[1:]

    # modalità file: -f percorso
    if args and args[0] == "-f":
        if len(args) < 2:
            sys.exit("[errore] uso: -f <file.txt>")
        with open(args[1], encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    show(clf, line)
        return

    # modalità una frase da riga di comando
    if args:
        show(clf, " ".join(args))
        return

    # modalità interattiva
    print(f"Modello: {MODEL_PATH}  |  soglia premium >= {THRESHOLD}")
    print("Scrivi una frase e premi Invio. (vuoto o Ctrl+C per uscire)\n")
    try:
        while True:
            text = input("> ").strip()
            if not text:
                break
            show(clf, text)
    except (KeyboardInterrupt, EOFError):
        print()


if __name__ == "__main__":
    main()
