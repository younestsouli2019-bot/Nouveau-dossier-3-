# =============================================================================
# Confronto modelli di Tier — Caro
# Pone ~50 domande DIFFICILI e VARIEGATE a entrambi i classificatori:
#   - tier_clf.joblib        (TF-IDF, parole)
#   - tier_clf_embed.joblib  (embedding, significato)
# e stampa per ciascuno la percentuale di successo, sia globale sia sul
# sottoinsieme di GENERALIZZAZIONE (frasi indirette / trabocchetti / fuori
# dai template di training).
#
# Uso:  python compare_models.py
#
# Etichette (design doc):
#   1 = premium : usa strumenti (email/calendario/news/web/file), scrive,
#                 analizza, multi-step, codice, pianifica.
#   0 = economy : saluti, fatto secco a un passo, MENZIONE di una parola,
#                 conversione/traduzione singola, definizione.
# =============================================================================

import os
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

import sys
import joblib

TFIDF_PATH = "tier_clf.joblib"
EMBED_PATH = "tier_clf_embed.joblib"
THRESHOLD = 0.50

# --------------------------------------------------------------------------- #
# Banco di prova: (testo, gold, gen)
#   gold = 1 premium / 0 economy
#   gen  = True se è un caso di GENERALIZZAZIONE (frase indiretta, trabocchetto
#          lessicale, o formulazione fuori dai template di training)
# --------------------------------------------------------------------------- #
CASES = [
    # ---- PREMIUM · italiano (indiretti / difficili) ---------------------- #
    ("secondo me mia moglie mi ha scritto, controlli tu?", 1, True),
    ("non ho voglia di leggere tutta 'sta relazione, tirane fuori il succo", 1, True),
    ("questo tizio mi ha fatto incavolare, aiutami a rispondere senza mandarlo a quel paese", 1, True),
    ("mi sa che ho un buco venerdì, verifica sull'agenda", 1, True),
    ("il preventivo dell'imbianchino mi pare alto, confrontalo con la media di mercato", 1, True),
    ("butta insieme quattro slide per la presentazione di lunedì", 1, True),
    ("questo foglio excel è un casino, riordinamelo per data", 1, True),
    ("mi hanno taggato in un post, guarda cosa dicono e riassumimelo", 1, True),
    ("scrivi al padrone di casa che il riscaldamento non va", 1, True),
    ("prendi nota che devo richiamare il commercialista", 1, True),
    ("dividi il conto della cena tra sei persone e dimmi quanto tocca a testa se aggiungo la mancia", 1, True),
    ("cerca un hotel a Napoli sotto i cento euro e mandami il link", 1, True),
    ("mi crei una playlist per la corsa di domani mattina?", 1, True),
    ("trascrivi questo vocale e mandalo a mia sorella", 1, True),
    ("controlla se il treno delle 8 è in ritardo", 1, True),
    ("fammi un piano di allenamento per la mezza maratona", 1, True),
    ("questa presentazione è troppo lunga, tagliala a dieci minuti", 1, True),
    ("segnati che il 3 devo pagare l'affitto", 1, True),
    ("dammi una mano a scrivere il curriculum, non so da dove partire", 1, True),
    ("controlla le previsioni e spostami la grigliata se piove", 1, True),
    ("scannerizza questa ricevuta e archiviala nella cartella spese", 1, True),
    ("mi calcoli il mutuo su vent'anni con questi tassi?", 1, True),
    ("ordina un mazzo di fiori per l'anniversario e fallo arrivare giovedì", 1, True),
    ("riscrivi il mio profilo linkedin in modo più professionale", 1, True),
    ("mi prepari le domande per il colloquio di domani?", 1, True),
    ("questo contratto è pieno di clausole strane, evidenziami quelle rischiose", 1, True),
    ("tienimi d'occhio il prezzo di quel monitor e avvisami se scende", 1, True),
    ("scrivi tu la didascalia per la foto del matrimonio", 1, True),
    ("fammi un riassunto delle notizie di oggi sul clima", 1, True),
    ("converti questo pdf in word e correggi i refusi", 1, True),
    ("prenota la sala riunioni per giovedì alle dieci", 1, True),
    ("dammi tre idee regalo per mia madre sotto i cinquanta euro", 1, True),

    # ---- PREMIUM · inglese (indiretti / difficili) ----------------------- #
    ("my landlord hasn't fixed the heating, help me write a firm email", 1, True),
    ("i can't be bothered reading this whole thread, just give me the gist", 1, True),
    ("i think i double booked friday, can you check my calendar", 1, True),
    ("throw together a quick budget for the trip and email it to my wife", 1, True),
    ("this spreadsheet is a mess, sort it by date for me", 1, True),
    ("draft a resignation letter, i don't know how to word it", 1, True),
    ("split the dinner bill among six people including a 10% tip", 1, True),
    ("find a hotel in barcelona under 100 a night and send me the link", 1, True),
    ("transcribe this voice note and forward it to my brother", 1, True),
    ("build me a training plan for a half marathon", 1, True),
    ("scan this receipt and file it under expenses", 1, True),
    ("keep an eye on the flight and let me know if it's delayed", 1, True),
    ("refactor this messy code and add comments", 1, True),
    ("pull the numbers from this invoice and add them up", 1, True),
    ("turn these bullet points into a proper cover letter", 1, True),
    ("order flowers for our anniversary and have them delivered thursday", 1, True),
    ("prep some interview questions for me for tomorrow", 1, True),
    ("watch the price of that monitor and ping me if it drops", 1, True),
    ("write a caption for our wedding photo", 1, True),
    ("convert this pdf to word and fix the typos", 1, True),
    ("book the meeting room for thursday at ten", 1, True),
    ("give me three gift ideas for my mum under fifty", 1, True),
    ("plan a three day itinerary for lisbon", 1, True),
    ("compare these two phones and tell me which is better value", 1, True),

    # ---- ECONOMY · italiano (basilari + trabocchetti) -------------------- #
    ("come si scrive 'efficienza'?", 0, True),
    ("cosa vuol dire l'espressione 'in bocca al lupo'?", 0, True),
    ("in che nazione si trova la Torre Eiffel?", 0, False),
    ("quanti minuti ci sono in un giorno?", 0, False),
    ("chi ha scritto l'Odissea?", 0, False),
    ("cosa significa la parola 'archiviare'?", 0, True),
    ("'trascrivere' che coniugazione è?", 0, True),
    ("quanto fa la radice quadrata di 81?", 0, False),
    ("in che regione si trova Bari?", 0, False),
    ("qual è il sinonimo di 'veloce'?", 0, False),
    ("come si dice 'buonanotte' in spagnolo?", 0, False),
    ("che giorno cade Ferragosto?", 0, False),
    ("cosa vuol dire quando si dice 'costa un occhio della testa'?", 0, True),
    ("buondì, ci sei?", 0, True),
    ("mi racconti una barzelletta?", 0, True),
    ("quante facce ha un cubo?", 0, False),
    ("non prenotare niente, dimmi solo cosa vuol dire 'caparra'", 0, True),
    ("senza fare calcoli, secondo te cos'è il tasso di interesse?", 0, True),
    ("'archivia' e 'archiviazione' sono la stessa cosa?", 0, True),
    ("perché il cielo è azzurro?", 0, False),
    ("quanti abitanti ha Roma più o meno?", 0, False),
    ("cosa vuol dire 'ridondante'?", 0, True),
    ("quanti angoli ha un pentagono?", 0, False),
    ("che moneta si usa in Giappone?", 0, False),
    ("come si scrive 'sufficiente'?", 0, True),
    ("quanti lati ha un ottagono?", 0, False),

    # ---- ECONOMY · inglese (basilari + trabocchetti) --------------------- #
    ("how do you spell 'efficiency'?", 0, True),
    ("what does the phrase 'break a leg' mean?", 0, True),
    ("what's the capital of norway?", 0, False),
    ("who wrote the odyssey?", 0, False),
    ("what does the word 'archive' mean?", 0, True),
    ("what's the square root of 81?", 0, False),
    ("what's a synonym for 'quick'?", 0, False),
    ("how do you say 'good night' in spanish?", 0, False),
    ("how many faces does a cube have?", 0, False),
    ("don't book anything, just tell me what a 'deposit' is", 0, True),
    ("without doing the math, what do you reckon interest rate means?", 0, True),
    ("why is the sky blue?", 0, False),
    ("good day, are you there?", 0, True),
    ("tell me a joke", 0, True),
    ("what's the largest animal in the world?", 0, False),
    ("what does 'redundant' mean?", 0, True),
    ("how many sides does a hexagon have?", 0, False),
    ("what's the longest river in the world?", 0, False),
    ("how do you spell 'sufficient'?", 0, True),
    ("what's a synonym for 'happy'?", 0, False),
]


def load_tfidf():
    if not os.path.exists(TFIDF_PATH):
        sys.exit(f"[errore] {TFIDF_PATH} non trovato — allena con train_tier_classifier.py")
    clf = joblib.load(TFIDF_PATH)

    def predict(text):
        return float(clf.predict_proba([text])[0][1])
    return predict


def load_embed():
    if not os.path.exists(EMBED_PATH):
        sys.exit(f"[errore] {EMBED_PATH} non trovato — allena con train_tier_embeddings.py")
    bundle = joblib.load(EMBED_PATH)
    clf = bundle["clf"]
    from sentence_transformers import SentenceTransformer
    print(f"[info] carico encoder: {bundle['model_name']} ...")
    encoder = SentenceTransformer(bundle["model_name"])

    def predict(text):
        v = encoder.encode([text], convert_to_numpy=True)
        return float(clf.predict_proba(v)[0][1])
    return predict


def main():
    print("[info] carico i due modelli...")
    tfidf = load_tfidf()
    embed = load_embed()

    name_a, name_b = "TF-IDF", "EMBED"
    stat = {name_a: {"ok": 0, "gen_ok": 0}, name_b: {"ok": 0, "gen_ok": 0}}
    n = len(CASES)
    n_gen = sum(1 for _, _, g in CASES if g)

    header = f"{'gold':>7} | {name_a:>18} | {name_b:>18} | frase"
    print("\n" + header)
    print("-" * len(header))

    for text, gold, gen in CASES:
        pa = tfidf(text)
        pb = embed(text)
        la = 1 if pa >= THRESHOLD else 0
        lb = 1 if pb >= THRESHOLD else 0
        oka, okb = (la == gold), (lb == gold)

        if oka:
            stat[name_a]["ok"] += 1
            if gen:
                stat[name_a]["gen_ok"] += 1
        if okb:
            stat[name_b]["ok"] += 1
            if gen:
                stat[name_b]["gen_ok"] += 1

        gold_s = "PREM" if gold else "econ"
        tag = "  [gen]" if gen else ""
        cell_a = f"{'PREM' if la else 'econ'} {pa:.2f} {'OK' if oka else 'XX'}"
        cell_b = f"{'PREM' if lb else 'econ'} {pb:.2f} {'OK' if okb else 'XX'}"
        print(f"{gold_s:>7} | {cell_a:>18} | {cell_b:>18} | {text}{tag}")

    print("\n" + "=" * 60)
    print(f"Domande totali: {n}  (di cui generalizzazione: {n_gen})\n")
    print(f"{'modello':>10} | {'successo globale':>18} | {'successo generalizz.':>22}")
    print("-" * 58)
    for name in (name_a, name_b):
        acc = 100.0 * stat[name]["ok"] / n
        gacc = 100.0 * stat[name]["gen_ok"] / n_gen if n_gen else 0.0
        print(f"{name:>10} | {stat[name]['ok']:>3}/{n}  {acc:5.1f}%     | "
              f"{stat[name]['gen_ok']:>3}/{n_gen}  {gacc:5.1f}%")

    a_acc = 100.0 * stat[name_a]["ok"] / n
    b_acc = 100.0 * stat[name_b]["ok"] / n
    winner = name_a if a_acc > b_acc else name_b if b_acc > a_acc else "pari"
    print("\n[verdetto] vincitore globale: " +
          (winner if winner == "pari" else f"{winner} ({max(a_acc, b_acc):.1f}%)"))


if __name__ == "__main__":
    main()
