#!/usr/bin/env bash
#
# The M2 bar. Drives a REAL server over a REAL socket with curl — the unit and
# integration tests use Fastify's inject(), which never opens one. Anything that
# only breaks on the wire (cookie handling, content types, the listen call
# itself) is invisible to them and visible here.
#
# Exits 0 only if every step passes.
set -euo pipefail

# .env is read by tsx at runtime, not by this shell — load it here too so
# DATABASE_URL is available for creating the throwaway smoke database.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# A fixed port of its own, deliberately not the one in .env — the smoke test
# must not collide with a dev server someone left running.
PORT=3999
BASE="http://127.0.0.1:$PORT"
DB="${SMOKE_DATABASE_URL:-${DATABASE_URL}_smoke}"
JAR_A="$(mktemp)"; JAR_B="$(mktemp)"
PSQL_BIN="/opt/homebrew/opt/postgresql@18/bin"
[ -d "$PSQL_BIN" ] && PATH="$PSQL_BIN:$PATH"

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$JAR_A" "$JAR_B"
  dropdb --if-exists "$(basename "$DB")" 2>/dev/null || true
}
trap cleanup EXIT

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

# Asserts an HTTP status. $1=expected $2=label, rest = curl args.
expect() {
  local want="$1" label="$2"; shift 2
  local got; got=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' "$@")
  [ "$got" = "$want" ] && pass "$label ($got)" || fail "$label: wanted $want, got $got — $(cat /tmp/smoke-body)"
}

echo "recall api smoke test"
dropdb --if-exists "$(basename "$DB")" 2>/dev/null || true
createdb "$(basename "$DB")"

# Rate limits are set low on purpose. The real defaults would need sixty
# requests to prove a 429, and a test that slow stops being run.
DATABASE_URL="$DB" PORT="$PORT" RATE_LIMIT_AUTH=20 RATE_LIMIT_ACCOUNT=3 \
  npm run start --silent >/tmp/smoke-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  curl -sf "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 0.2
done
curl -sf "$BASE/api/health" >/dev/null || { cat /tmp/smoke-server.log; fail "server never came up"; }
pass "server listening on $PORT, migrations applied on boot"

json=(-H 'content-type: application/json')

# Pulls the CSRF token out of a cookie jar. Every state-changing request needs
# it in a header — a browser attaches cookies by itself but will not set this,
# which is exactly why it works as a CSRF defence (ADR-021).
csrf() { awk '/recall_csrf/ { print $7 }' "$1"; }
# Registration takes a handle; login takes one identifier that may be either.
A='{"email":"alice@example.com","username":"alice","password":"a-good-password"}'
B='{"email":"bob@example.com","username":"bob","password":"a-good-password"}'
A_LOGIN='{"identifier":"alice@example.com","password":"a-good-password"}'
A_BY_HANDLE='{"identifier":"alice","password":"a-good-password"}'
B_LOGIN='{"identifier":"bob@example.com","password":"a-good-password"}'

expect 201 "alice registers"      -X POST "${json[@]}" -d "$A" "$BASE/api/users"
expect 409 "duplicate is refused" -X POST "${json[@]}" -d "$A" "$BASE/api/users"
expect 409 "taken handle refused" -X POST "${json[@]}" -d '{"email":"other@example.com","username":"alice","password":"a-good-password"}' "$BASE/api/users"
expect 401 "wrong password"       -X POST "${json[@]}" -d '{"identifier":"alice@example.com","password":"nope-nope"}' "$BASE/api/sessions"
expect 201 "alice logs in"        -X POST "${json[@]}" -d "$A_LOGIN" -c "$JAR_A" "$BASE/api/sessions"
expect 201 "and by her handle"    -X POST "${json[@]}" -d "$A_BY_HANDLE" "$BASE/api/sessions"
grep -q recall_session "$JAR_A" && pass "session cookie was set" || fail "no session cookie"
grep -qi httponly    "$JAR_A" && pass "session cookie is HttpOnly" || fail "session cookie is not HttpOnly"
[ -n "$(csrf "$JAR_A")" ] && pass "CSRF token cookie is readable" || fail "no readable CSRF cookie"

expect 401 "no cookie is refused" "$BASE/api/decks"
expect 403 "a write with the cookie but no CSRF token" -X POST "${json[@]}" \
  -d '{"name":"Algorithms"}' -b "$JAR_A" "$BASE/api/decks"
CSRF_A="-H x-csrf-token:$(csrf "$JAR_A")"
# shellcheck disable=SC2086
expect 201 "alice creates a deck" -X POST "${json[@]}" $CSRF_A -d '{"name":"Algorithms"}' -b "$JAR_A" "$BASE/api/decks"
DECK=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)

# shellcheck disable=SC2086
expect 201 "alice adds a card" -X POST "${json[@]}" $CSRF_A \
  -d '{"front":"What is a heap?","back":"A tree with the heap property"}' -b "$JAR_A" "$BASE/api/decks/$DECK/cards"
CARD=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)

expect 200 "the card is due today" -b "$JAR_A" "$BASE/api/decks/$DECK/cards/due"
grep -q 'What is a heap' /tmp/smoke-body && pass "due list contains it" || fail "due list is empty"

# shellcheck disable=SC2086
expect 201 "grade: good"  -X POST "${json[@]}" $CSRF_A -d '{"grade":"good"}'  -b "$JAR_A" "$BASE/api/cards/$CARD/reviews"
# FSRS-6, not SM-2 (ADR-035). The first `good` sets stability to w[2] = 2.3065
# days, and at the default 90% requested retention the interval is the rounded
# stability. SM-2's answer here was 1 day.
grep -q '"intervalDays":2' /tmp/smoke-body && pass "first good -> 2 days" || fail "wrong interval: $(cat /tmp/smoke-body)"
grep -q '"stability":2.3065' /tmp/smoke-body && pass "and stability is the initial weight" || fail "wrong stability: $(cat /tmp/smoke-body)"
# shellcheck disable=SC2086
expect 201 "grade: good again" -X POST "${json[@]}" $CSRF_A -d '{"grade":"good"}' -b "$JAR_A" "$BASE/api/cards/$CARD/reviews"
# Answering the same card twice in one sitting is FSRS's short-term branch —
# there was no elapsed time, so nothing was forgotten and nothing is proved.
# The interval holds rather than growing, which is the behaviour SM-2 got
# wrong: it would have moved this card straight to 6 days.
grep -q '"intervalDays":2' /tmp/smoke-body && pass "a same-day repeat does not extend the interval" \
  || fail "same-day repeat moved the interval: $(cat /tmp/smoke-body)"

ELAPSED=$(psql "$DB" -tAc "select string_agg(elapsed_days::text, ',' order by id) from reviews")
[ "$ELAPSED" = "0,0" ] && pass "and both reviews recorded the elapsed time they saw" \
  || fail "expected elapsed_days 0,0 — got '$ELAPSED'"

REVIEWS=$(psql "$DB" -tAc "select count(*) from reviews")
[ "$REVIEWS" = "2" ] && pass "both reviews were recorded as events (ADR-010)" || fail "expected 2 review rows, got $REVIEWS"

# --- editing and soft delete (migration 005) ---------------------------------
# shellcheck disable=SC2086
expect 200 "alice edits the card" -X PATCH "${json[@]}" $CSRF_A \
  -d '{"back":"A complete binary tree with the heap property"}' -b "$JAR_A" "$BASE/api/cards/$CARD"
grep -q 'complete binary tree' /tmp/smoke-body && pass "the edit came back" || fail "edit not returned"
grep -q '"intervalDays":2' /tmp/smoke-body && pass "editing did not reschedule it" || fail "edit moved the schedule"

# shellcheck disable=SC2086
expect 204 "alice deletes the card" -X DELETE $CSRF_A -b "$JAR_A" "$BASE/api/cards/$CARD"
expect 404 "deleting it twice is a 404" -X DELETE $CSRF_A -b "$JAR_A" "$BASE/api/cards/$CARD"
expect 200 "the deck list still answers" -b "$JAR_A" "$BASE/api/decks"
grep -q '"cardCount":0' /tmp/smoke-body && pass "and counts the deck as empty" || fail "count still includes it: $(cat /tmp/smoke-body)"

KEPT=$(psql "$DB" -tAc "select count(*) from reviews where card_id = $CARD")
[ "$KEPT" = "2" ] && pass "its reviews survived the delete" || fail "expected 2 review rows, got $KEPT"
GONE=$(psql "$DB" -tAc "select deleted_at is not null from cards where id = $CARD")
[ "$GONE" = "t" ] && pass "the card row is marked, not removed" || fail "card row is gone or unmarked: '$GONE'"

expect 201 "bob registers"  -X POST "${json[@]}" -d "$B" "$BASE/api/users"
expect 201 "bob logs in"    -X POST "${json[@]}" -d "$B_LOGIN" -c "$JAR_B" "$BASE/api/sessions"
expect 403 "bob is refused alice's deck" -b "$JAR_B" "$BASE/api/decks/$DECK"
CSRF_B="-H x-csrf-token:$(csrf "$JAR_B")"
expect 200 "bob's own deck list is empty" -b "$JAR_B" "$BASE/api/decks"
[ "$(cat /tmp/smoke-body)" = "[]" ] && pass "and it really is empty" || fail "bob sees $(cat /tmp/smoke-body)"

# --- publishing and copying (ADR-041) ----------------------------------------
# Over a real socket because this is where authorisation widened: two cookie
# jars, one deck, and the question of which of them may do what.

# shellcheck disable=SC2086
expect 200 "alice publishes her deck" -X PATCH "${json[@]}" $CSRF_A \
  -b "$JAR_A" -d '{"visibility":"public"}' "$BASE/api/decks/$DECK"

expect 200 "bob can now read it"       -b "$JAR_B" "$BASE/api/decks/$DECK"
grep -q '"role":"visitor"' /tmp/smoke-body && pass "and is told he is a visitor" \
  || fail "no visitor role: $(cat /tmp/smoke-body)"
expect 200 "and read its cards"        -b "$JAR_B" "$BASE/api/decks/$DECK/cards"
grep -q 'stability' /tmp/smoke-body && fail "scheduler state leaked to a visitor: $(cat /tmp/smoke-body)" \
  || pass "without any of alice's scheduler state"

# Publishing granted reads. It granted nothing else, and that is the invariant
# the whole design rests on.
# shellcheck disable=SC2086
expect 403 "bob still cannot add a card" -X POST "${json[@]}" $CSRF_B \
  -b "$JAR_B" -d '{"front":"mine","back":"now"}' "$BASE/api/decks/$DECK/cards"
# shellcheck disable=SC2086
expect 403 "nor delete her deck" -X DELETE $CSRF_B -b "$JAR_B" "$BASE/api/decks/$DECK"
# shellcheck disable=SC2086
expect 403 "nor unpublish it" -X PATCH "${json[@]}" $CSRF_B \
  -b "$JAR_B" -d '{"visibility":"private"}' "$BASE/api/decks/$DECK"

# shellcheck disable=SC2086
expect 201 "bob copies it into his own account" -X POST "${json[@]}" $CSRF_B \
  -b "$JAR_B" -d '{"name":"Alice'"'"'s deck"}' "$BASE/api/decks/$DECK/copy"
COPY=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
FRESH=$(psql "$DB" -tAc "select count(*) from cards where deck_id = $COPY and (stability is not null or due_on <> current_date)")
[ "$FRESH" = "0" ] && pass "and every copied card starts from scratch" \
  || fail "$FRESH copied cards carried scheduler state"
LABEL=$(psql "$DB" -tAc "select copied_from_label from decks where id = $COPY")
[ -n "$LABEL" ] && pass "with the original credited: $LABEL" || fail "no attribution recorded"

# shellcheck disable=SC2086
expect 200 "alice unpublishes" -X PATCH "${json[@]}" $CSRF_A \
  -b "$JAR_A" -d '{"visibility":"private"}' "$BASE/api/decks/$DECK"
expect 403 "and bob is shut out again" -b "$JAR_B" "$BASE/api/decks/$DECK"
expect 200 "but his copy is untouched" -b "$JAR_B" "$BASE/api/decks/$COPY"

# --- export and import (ADR-036) ---------------------------------------------
# Over the wire on purpose: the file is produced by one account and consumed by
# another, and -d @file is the closest curl gets to what the browser does with
# a blob it just downloaded.

# shellcheck disable=SC2086
expect 201 "alice adds a second card" -X POST "${json[@]}" $CSRF_A \
  -d '{"front":"What is a trie?","back":"A prefix tree"}' -b "$JAR_A" "$BASE/api/decks/$DECK/cards"

expect 200 "alice exports the deck" -b "$JAR_A" "$BASE/api/decks/$DECK/export"
cp /tmp/smoke-body /tmp/smoke-deck.json
grep -q '"format":"recall.deck.v1"' /tmp/smoke-deck.json && pass "the file is stamped with the format" \
  || fail "no format stamp: $(cat /tmp/smoke-deck.json)"
grep -q 'What is a trie' /tmp/smoke-deck.json && pass "and carries the live card" || fail "live card missing"
# The deleted card and every scheduler column must be absent. Alice has graded
# in this run, so both are states the export could actually leak.
grep -q 'What is a heap' /tmp/smoke-deck.json && fail "the export resurrected a deleted card" \
  || pass "the deleted card is not in it"
grep -qE 'stability|difficulty|dueOn|repetitions' /tmp/smoke-deck.json \
  && fail "the export leaked scheduler state: $(cat /tmp/smoke-deck.json)" \
  || pass "and no trace of how well alice knows it"

CSRF_B="-H x-csrf-token:$(csrf "$JAR_B")"
# Bob owns no decks, so "Algorithms" is free for him — the same name under a
# different owner is fine, which is what the unique constraint is scoped to.
# shellcheck disable=SC2086
expect 201 "bob imports the file unchanged" -X POST "${json[@]}" $CSRF_B \
  -d @/tmp/smoke-deck.json -b "$JAR_B" "$BASE/api/decks/import"
BOBS_DECK=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
grep -q '"cardCount":1' /tmp/smoke-body && pass "with the card count it reported" || fail "wrong count: $(cat /tmp/smoke-body)"

SRC=$(psql "$DB" -tAc "select distinct source from cards where deck_id = $BOBS_DECK")
[ "$SRC" = "imported" ] && pass "the cards are recorded as imported (migration 007)" \
  || fail "expected source 'imported', got '$SRC'"
FRESH=$(psql "$DB" -tAc "select count(*) from cards where deck_id = $BOBS_DECK and (stability is not null or repetitions <> 0)")
[ "$FRESH" = "0" ] && pass "and arrive unreviewed, whatever alice's history was" \
  || fail "$FRESH imported cards carried scheduler state"

# shellcheck disable=SC2086
expect 409 "importing it twice conflicts on the name" -X POST "${json[@]}" $CSRF_B \
  -d @/tmp/smoke-deck.json -b "$JAR_B" "$BASE/api/decks/import"
ORPHANS=$(psql "$DB" -tAc "select count(*) from cards where deck_id not in (select id from decks)")
[ "$ORPHANS" = "0" ] && pass "and the failed import rolled back cleanly" || fail "$ORPHANS orphan cards"

expect 403 "bob cannot export alice's deck" -b "$JAR_B" "$BASE/api/decks/$DECK/export"

# The round trip must be total. A deck whose cards were all soft-deleted exports
# an empty card list, and refusing that on import made this app produce a file it
# could not read — a failure that only surfaces on the importing machine.
# shellcheck disable=SC2086
expect 201 "alice makes a deck and empties it" -X POST "${json[@]}" $CSRF_A \
  -d '{"name":"Emptied"}' -b "$JAR_A" "$BASE/api/decks"
EMPTIED=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
# shellcheck disable=SC2086
expect 201 "with one card" -X POST "${json[@]}" $CSRF_A \
  -d '{"front":"doomed","back":"not for long"}' -b "$JAR_A" "$BASE/api/decks/$EMPTIED/cards"
DOOMED=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
# shellcheck disable=SC2086
expect 204 "then deletes it" -X DELETE $CSRF_A -b "$JAR_A" "$BASE/api/cards/$DOOMED"
expect 200 "the empty deck still exports" -b "$JAR_A" "$BASE/api/decks/$EMPTIED/export"
cp /tmp/smoke-body /tmp/smoke-empty.json
grep -q '"cards":\[\]' /tmp/smoke-empty.json && pass "with no cards in it" || fail "expected an empty card list: $(cat /tmp/smoke-empty.json)"
# shellcheck disable=SC2086
expect 201 "and bob can import what she exported" -X POST "${json[@]}" $CSRF_B \
  -d @/tmp/smoke-empty.json -b "$JAR_B" "$BASE/api/decks/import"

# A rejection names the field and the reason. The client shows `details` when
# they are there, so a generic message here is a generic message on screen.
# shellcheck disable=SC2086
expect 400 "an over-long card is refused" -X POST "${json[@]}" $CSRF_B -b "$JAR_B" \
  -d "{\"format\":\"recall.deck.v1\",\"name\":\"Too long\",\"cards\":[{\"front\":\"$(printf 'x%.0s' $(seq 1 1001))\",\"back\":\"a\"}]}" \
  "$BASE/api/decks/import"
grep -q '"field":"cards.0.front"' /tmp/smoke-body && pass "and says which field" || fail "no field in: $(cat /tmp/smoke-body)"

# --- deleting a deck (migration 008) -----------------------------------------
# shellcheck disable=SC2086
expect 201 "alice makes a deck to delete" -X POST "${json[@]}" $CSRF_A \
  -d '{"name":"Doomed"}' -b "$JAR_A" "$BASE/api/decks"
DOOMED_DECK=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
# shellcheck disable=SC2086
expect 201 "with a card in it" -X POST "${json[@]}" $CSRF_A \
  -d '{"front":"gone soon","back":"indeed"}' -b "$JAR_A" "$BASE/api/decks/$DOOMED_DECK/cards"
DOOMED_CARD=$(sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' /tmp/smoke-body)
# shellcheck disable=SC2086
expect 201 "that she reviews once" -X POST "${json[@]}" $CSRF_A -d '{"grade":"good"}' \
  -b "$JAR_A" "$BASE/api/cards/$DOOMED_CARD/reviews"

REVIEWS_BEFORE=$(psql "$DB" -tAc "select count(*) from reviews")

# shellcheck disable=SC2086
expect 204 "alice deletes the deck" -X DELETE $CSRF_A -b "$JAR_A" "$BASE/api/decks/$DOOMED_DECK"
# shellcheck disable=SC2086
expect 404 "deleting it twice is a 404" -X DELETE $CSRF_A -b "$JAR_A" "$BASE/api/decks/$DOOMED_DECK"
expect 404 "and it cannot be fetched" -b "$JAR_A" "$BASE/api/decks/$DOOMED_DECK"
# shellcheck disable=SC2086
expect 404 "nor can its card be graded" -X POST "${json[@]}" $CSRF_A -d '{"grade":"good"}' \
  -b "$JAR_A" "$BASE/api/cards/$DOOMED_CARD/reviews"

# The point of a soft delete, asserted against the table rather than the API:
# reviews.card_id is `on delete restrict`, so a hard delete could not have
# happened at all, and the history has to be exactly as it was.
REVIEWS_AFTER=$(psql "$DB" -tAc "select count(*) from reviews")
[ "$REVIEWS_BEFORE" = "$REVIEWS_AFTER" ] && pass "every review survived ($REVIEWS_AFTER)" \
  || fail "reviews went from $REVIEWS_BEFORE to $REVIEWS_AFTER"
MARKED=$(psql "$DB" -tAc "select count(*) from cards where deck_id = $DOOMED_DECK and deleted_at is null")
[ "$MARKED" = "0" ] && pass "and its cards were marked with it" || fail "$MARKED cards left live"

# The partial unique index from migration 008: the dead row no longer holds the
# name, so it is available again straight away.
# shellcheck disable=SC2086
expect 201 "the name is free again" -X POST "${json[@]}" $CSRF_A \
  -d '{"name":"Doomed"}' -b "$JAR_A" "$BASE/api/decks"

expect 204 "alice logs out" -X DELETE -b "$JAR_A" "$BASE/api/sessions"
expect 401 "her cookie stops working" -b "$JAR_A" "$BASE/api/decks"

# --- rate limiting (ADR-031) -------------------------------------------------
# Last in the file: these deliberately exhaust an allowance, and the per-address
# counter is shared with everything above.
guess() { curl -sS -o /tmp/smoke-body -D /tmp/smoke-head -w '%{http_code}' \
  -X POST "${json[@]}" -d "{\"identifier\":\"$1\",\"password\":\"wrong-password-here\"}" \
  "$BASE/api/sessions"; }

for i in 1 2 3; do
  [ "$(guess carol@example.com)" = "401" ] && pass "guess $i at carol is answered 401" \
    || fail "guess $i was not 401"
done
[ "$(guess carol@example.com)" = "429" ] && pass "the fourth guess at one account is refused" \
  || fail "the per-account limit never bit"
grep -qi '^retry-after: [1-9]' /tmp/smoke-head && pass "and it says when to come back" \
  || fail "no usable Retry-After header: $(grep -i retry /tmp/smoke-head)"

# A different account from the same address still works, so what refused carol
# was her identifier and not the address.
[ "$(guess dave@example.com)" = "401" ] && pass "another account is unaffected" \
  || fail "the per-account limit locked out an unrelated account"

# Two spellings of one real account share one allowance. Keyed on what was
# typed, these four would be two buckets of three and none would be refused —
# and a handle is public, so knowing both spellings is not privileged.
curl -sS -o /dev/null -X POST "${json[@]}" \
  -d '{"email":"erin@example.com","username":"erin","password":"a-good-password"}' \
  "$BASE/api/users"
[ "$(guess erin@example.com)" = "401" ] && [ "$(guess erin)" = "401" ] \
  && [ "$(guess erin@example.com)" = "401" ] \
  && pass "three guesses at erin, spelled both ways, are answered 401" \
  || fail "a guess at erin was refused too early"
[ "$(guess erin)" = "429" ] && pass "the fourth is refused whichever spelling it uses" \
  || fail "alternating the identifier doubled the allowance"

# Now the address limit. Every email here is new, so the per-account limiter
# cannot be what answers — its counter for each is untouched.
TRIPPED=""
for i in $(seq 1 30); do
  [ "$(guess "burst$i@example.com")" = "429" ] && { TRIPPED=$i; break; }
done
[ -n "$TRIPPED" ] && pass "a burst of distinct accounts is refused after $TRIPPED from one address" \
  || fail "the per-address limit never bit in 30 attempts"

echo; echo "  all good"
