#!/usr/bin/env bash
set -euo pipefail

# Run on a clean, dedicated branch in the destination repository.
root=$(git rev-parse --show-toplevel)
cd "$root"
git filter-repo --version >/dev/null
git lfs version >/dev/null
git var GIT_AUTHOR_IDENT >/dev/null
git var GIT_COMMITTER_IDENT >/dev/null

if [[ -n $(git status --porcelain) ]]; then
  echo "Destination worktree must be clean." >&2
  exit 1
fi
if [[ -e docs/metiutek-migration ]]; then
  echo "Migration records already exist; refusing to run twice." >&2
  exit 1
fi

repos=(lithophane-studio llm-tier-router rvm-web editorimage-ai Vortelio tube-assistant editorvideo-ai)
for name in "${repos[@]}"; do
  if [[ -e "projects/$name" ]] || [[ -n $(git for-each-ref "refs/heads/import/$name/" "refs/tags/import/$name/") ]]; then
    echo "Destination path or import refs already exist for $name." >&2
    exit 1
  fi
done

scratch=$(mktemp -d "${TMPDIR:-/tmp}/metiutek-import.XXXXXXXX")
echo "Scratch directory (retained for inspection): $scratch"
mkdir -p docs/metiutek-migration
for name in "${repos[@]}"; do
  url="https://github.com/metiutek/$name.git"
  mirror="$scratch/$name.git"
  echo "Importing $name..."
  default_ref=$(git ls-remote --symref "$url" HEAD | sed -n 's/^ref: \(refs\/heads\/[^[:space:]]*\)[[:space:]]*HEAD$/\1/p')
  if [[ -z "$default_ref" ]]; then
    echo "Cannot determine default branch for $name." >&2
    exit 1
  fi
  git clone --quiet --mirror "$url" "$mirror"
  lfs_files=$(git --git-dir="$mirror" lfs ls-files --all)
  if [[ -n "$lfs_files" ]]; then
    echo "$name contains Git LFS objects; migrate and verify LFS storage separately before importing." >&2
    exit 1
  fi
  git --git-dir="$mirror" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags \
    > "docs/metiutek-migration/$name-original-refs.txt"
  original_count=$(git --git-dir="$mirror" rev-list --all --count)
  (
    cd "$mirror"
    git -c safe.bareRepository=all filter-repo --to-subdirectory-filter "projects/$name" \
      --prune-empty never --prune-degenerate never --preserve-commit-hashes --preserve-commit-encoding
  )
  cp "$mirror/filter-repo/commit-map" "docs/metiutek-migration/$name-commit-map.txt"
  cp "$mirror/filter-repo/ref-map" "docs/metiutek-migration/$name-ref-map.txt"
  mapped_count=$(awk 'NR > 1 { n++ } END { print n+0 }' "docs/metiutek-migration/$name-commit-map.txt")
  rewritten_count=$(git --git-dir="$mirror" rev-list --all --count)
  if [[ "$original_count" != "$mapped_count" || "$original_count" != "$rewritten_count" ]]; then
    echo "Commit count mismatch for $name: original=$original_count mapped=$mapped_count rewritten=$rewritten_count." >&2
    exit 1
  fi
  if awk 'NR > 1 && $2 ~ /^0+$/ { exit 1 }' "docs/metiutek-migration/$name-commit-map.txt"; then
    :
  else
    echo "A commit was removed from $name; stopping." >&2
    exit 1
  fi
  git fetch --no-tags "$mirror" \
    "+refs/heads/*:refs/heads/import/$name/*" \
    "+refs/tags/*:refs/tags/import/$name/*"
  branch=${default_ref#refs/heads/}
  message_args=(-m "Import $name history into projects/$name")
  if [[ -n ${MIGRATION_COMMIT_TRAILER:-} ]]; then
    message_args+=(-m "$MIGRATION_COMMIT_TRAILER")
  fi
  git merge --no-ff --allow-unrelated-histories "refs/heads/import/$name/$branch" "${message_args[@]}"
done
git add docs/metiutek-migration
message_args=(-m "Record source history migration mappings")
if [[ -n ${MIGRATION_COMMIT_TRAILER:-} ]]; then
  message_args+=(-m "$MIGRATION_COMMIT_TRAILER")
fi
git commit "${message_args[@]}"
echo "Import complete. Push the current branch and the refs/heads/import/ and refs/tags/import/ namespaces separately after review."
