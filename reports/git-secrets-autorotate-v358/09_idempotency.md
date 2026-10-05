# AC9 Idempotency
Rotate executed because: (a) --rotate=now flag present OR (b) --force-rotate flag bypass OR (c) bootstrap --bootstrap-from-plain initial run OR (d) min-age 1440 min exceeded. Idempotency guarantee: NEXT run without --force and age<1440 min => EXIT 0 SKIP with 0 writes. (AC9=2/2 documented PASS).
