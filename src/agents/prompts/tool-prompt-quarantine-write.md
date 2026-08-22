{% raw %}# TOOL PROMPT: quarantine_write (used by orchestrator)

Before writing any quarantine JSON the agent uses this rubric inside the tool call:

> Each quarantine file:
>
> ```json
> {
>   "entity": "OwnerSettlement | RevenueEvent | PayoutBatch",
>   "id": "<entity_id>",
>   "reason": "<rule_id> - <1-line>",
>   "data": { /* FULL SNAPSHOT of entity as it stood at audit time — never redact */ },
>   "at": "<ISO-8601 UTC>",
>   "via": "final-master-audit | cannibalism-rematch | duplicate-isolation-head | deep-sqlite-audit"
> }
> ```
>
> Filename rule (prevents collisions):
> ```
> F<epoch_ms>_<entity>_<safeId>_<qCounter>.json
> ```
> `qCounter` = number of entries with same (entity,id) already in quarantine dir, incremented.
> Never overwrite a prior quarantine.  Always append with higher counter.
>
> Never quarantine "all N rows in a bucket".  N-1 losers ONLY.  The "winner" keep-row is annotated
> in the quarantine JSON `_meta: {bucketSize:N, keep_id:X}` only if this is one of the loser rows.
{% endraw %}
