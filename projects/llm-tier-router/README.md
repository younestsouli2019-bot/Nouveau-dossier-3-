<h1 align="center">LLM Tier Router — send the cheap model the easy prompts</h1>

<p align="center">
  <strong>A millisecond classifier that decides, per message, whether your agent needs the expensive model or the cheap one.</strong><br/>
  97.6 % accuracy, multilingual, fail-safe by design. Trained on 12,130 labelled prompts, included in this repo.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/accuracy-97.6%25-brightgreen?style=flat-square" alt="Accuracy"/>
  <img src="https://img.shields.io/badge/dataset-12%2C130%20examples-blue?style=flat-square" alt="Dataset"/>
  <img src="https://img.shields.io/badge/latency-~1%20ms-orange?style=flat-square" alt="Latency"/>
  <img src="https://img.shields.io/badge/languages-IT%20%2B%20EN-informational?style=flat-square" alt="Languages"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"/>
</p>

---

## The problem

Most messages an assistant receives do not need a frontier model. "hi", "what does
API stand for", "translate this line" — a small model answers them identically for a
fraction of the price. But you cannot know which is which until you have already
paid to find out.

This is the router that decides first. It reads the user's message and outputs one
bit before any model is called:

- **`1` = premium** — tool use (email, calendar, web, files), writing and analysis,
  multi-step reasoning, code, planning, high-level explanation.
- **`0` = economy** — greetings, small talk, one-step facts, single definitions,
  one-off translation or conversion, simple explanations.

It is deliberately **fail-safe**: when in doubt, it escalates to premium. A wrong
cheap answer costs a user; a wrong expensive answer costs a cent.

## Two approaches, benchmarked

| | File | How it works | Weak spot |
|---|---|---|---|
| **TF-IDF** | `train_tier_classifier.py` | word/n-gram counts + logistic regression | blind to synonyms, context and other languages |
| **Embeddings** | `train_tier_embeddings.py` | multilingual transformer → meaning vector + logistic regression | heavier dependency (pulls torch) |

The embedding model uses `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.
The transformer is **pretrained and frozen** — only a `LogisticRegression` is trained
on top of its vectors. Because it encodes meaning rather than words, it generalises to
paraphrases, slang and **English**, even though most of the dataset is Italian.

## Results

Test bench (`compare_models.py`): ~100 questions **outside the training set**, IT + EN,
from trivial to indirect and deliberately misleading, hand-labelled.

| model | overall accuracy | on generalisation |
|---|---:|---:|
| TF-IDF | ~87.2 % | ~83 % |
| **Embeddings** | **~97.6 %** | **~95 %** |

The embedding model wins by ~12 points and generalises across languages with no
dedicated English data in training. It is the right choice for this use case.

## Dataset

`tier_dataset.json` — **12,130 examples** (6,200 premium / 5,930 economy), balanced,
minimal format:

```json
{ "text": "summarise my last emails and draft a reply to my boss", "label": 1 }
```

Usable on its own, independently of this code, for any premium/economy routing task.

## Usage

```bash
pip install scikit-learn joblib numpy sentence-transformers

# training (produces the .joblib models)
python train_tier_classifier.py     # TF-IDF    -> tier_clf.joblib
python train_tier_embeddings.py     # embedding -> tier_clf_embed.joblib
#   (first run downloads ~118 MB of model; encodings are cached in embeddings_cache.npy)

# head-to-head comparison on the test bench
python compare_models.py

# interactive check (type a sentence, see the tier + probability)
python test_tier_embeddings.py
python test_tier_classifier.py
```

Dependencies: `scikit-learn`, `joblib`, `numpy` — plus `sentence-transformers`
(which pulls `torch`) for the embedding model.

## Files

| File | What it is |
|---|---|
| `classificatore-tier.md` | design document (idea, libraries, data format, backend integration) — in Italian |
| `tier_dataset.json` | training dataset (JSON, IT + EN) |
| `train_tier_classifier.py` / `train_tier_embeddings.py` | TF-IDF / embedding training |
| `test_tier_classifier.py` / `test_tier_embeddings.py` | interactive check |
| `compare_models.py` | comparison bench between the two models |
| `tier_clf.joblib` / `tier_clf_embed.joblib` | trained models |

> `embeddings_cache.npy` is not versioned (regenerable cache, ~18 MB): it is rebuilt on
> the first `train_tier_embeddings.py` run.

## Status and next steps

The model is ready to be put behind a `DYNAMIC_TIER` flag and A/B tested against real
logs (see the design doc, §10). Open levers to improve beyond the bench:

1. **Label consistency** — an explicit rubric (does it need a tool? multi-step?
   writing/analysis? depth?) is worth more than more data.
2. **Uncertainty band** — when `p_premium` sits near 0.5, escalate to premium
   (fail-safe) or to a small LLM judge instead of deciding outright.
3. **Stronger encoder** (`multilingual-e5`, `bge-m3`) for more semantic margin.

## License

MIT
