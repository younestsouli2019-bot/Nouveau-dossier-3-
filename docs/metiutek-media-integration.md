# Metiutek import and media adapters

## History import

`scripts/import-metiutek-histories.sh` imports the seven source repositories
into an **existing**, clean destination checkout. Install Git, Git LFS and
`git-filter-repo`, configure a Git author and committer, and run it on a new,
dedicated branch. It downloads full mirror clones, leaves its scratch directory
in place for inspection, and stops if the destination paths or local import
refs already exist. A failed run can leave partial merges, refs and migration
records; inspect them before starting again.

The default branches are merged under `projects/<name>`. Other source branches
and tags remain available as `refs/heads/import/<name>/<branch>` and
`refs/tags/import/<name>/<tag>`. Advertised pull-request refs are retained as
`refs/heads/import-pulls/<name>/<number>/<head-or-merge>`. Merely pushing the integration branch does
not push those refs. Check the destination for namespace conflicts, then push
the branch and the import refs explicitly; never force-push existing refs.
The commit-map, ref-map and original ref list in `docs/metiutek-migration/`
record the provenance. Empty and degenerate commits are retained. Rewriting
paths necessarily changes commit IDs, and commit and tag signatures no longer
verify. The script aborts for Git LFS histories rather than silently importing
pointer files without their content.

The root TypeScript, ESLint, Docker and Vercel configurations exclude
`projects/` to preserve the existing application's build and deployment
scope. Build and test each imported project using its own tooling.

## Media adapters

The repository does not contain the referenced WAV masters, ACE-Step runner,
LangGraph media graph, ComfyUI workflows, or subtitle transcripts. These
adapters do not start a daemon, generate assets, approve releases, or publish
anything by themselves.

* `scripts/edu-ai-comfyui-video.mjs` accepts a ComfyUI **API-format** workflow,
  queues it, checks history for execution errors and downloads a selected
  output descriptor. A running, separately configured ComfyUI and installed
  models are required. No model selection, territorial checks, VRAM lock or
  model unloading is performed.
* `scripts/edu-ace-step-audio.mjs` stages the named masters from the repository
  root or runs a separately supplied `scripts/run_ace_step.py` using argument
  vectors. The output must be a non-empty 44.1 kHz PCM WAV. Missing named
  masters are errors, not an instruction to generate substitute audio.
* `scripts/promo-publish-protocol.mjs` requires explicit `approved: true`,
  caller-supplied rights and PeerTube licence metadata, a local Kubo executable,
  and a writable JSONL ledger. It requests optional Pinata pinning and uploads
  publicly to PeerTube. A successful Pinata request is not proof of completed
  remote pinning. Ledger entries are written after each external step: a
  failure can leave an IPFS object, pin request or video already created, so
  inspect the ledger and service before retrying. It does not publish to the
  Internet Archive, YouTube, RSS, or Mastodon and does not establish rights.

Before connecting these adapters to an orchestrator, supply real workflows,
assets and transcripts; implement a cross-process GPU lock and a verified
worker shutdown/unload protocol; select models only after establishing the
worker's jurisdiction and reviewing applicable licence terms; implement
actual quality and volume checks, caption timing/burn-in, a persistent human
approval gate, a five-iteration verification ceiling, and the remaining
publishing destinations. `visual-intelligence.mjs` currently verifies public
images rather than video, and `video-synthesis.mjs` muxes audio but does not
perform the requested caption burn-in or beat alignment. Sequential calls or
`torch.cuda.empty_cache()` alone cannot guarantee VRAM availability.

Run the isolated adapter tests with:

```sh
node --test scripts/test/media-workers.test.mjs
```
