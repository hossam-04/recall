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
A='{"email":"alice@example.com","password":"a-good-password"}'
B='{"email":"bob@example.com","password":"a-good-password"}'

expect 201 "alice registers"      -X POST "${json[@]}" -d "$A" "$BASE/api/users"
expect 409 "duplicate is refused" -X POST "${json[@]}" -d "$A" "$BASE/api/users"
expect 401 "wrong password"       -X POST "${json[@]}" -d '{"email":"alice@example.com","password":"nope-nope"}' "$BASE/api/sessions"
expect 201 "alice logs in"        -X POST "${json[@]}" -d "$A" -c "$JAR_A" "$BASE/api/sessions"
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
expect 201 "bob logs in"    -X POST "${json[@]}" -d "$B" -c "$JAR_B" "$BASE/api/sessions"
expect 403 "bob is refused alice's deck" -b "$JAR_B" "$BASE/api/decks/$DECK"
expect 200 "bob's own deck list is empty" -b "$JAR_B" "$BASE/api/decks"
[ "$(cat /tmp/smoke-body)" = "[]" ] && pass "and it really is empty" || fail "bob sees $(cat /tmp/smoke-body)"

expect 204 "alice logs out" -X DELETE -b "$JAR_A" "$BASE/api/sessions"
expect 401 "her cookie stops working" -b "$JAR_A" "$BASE/api/decks"

# --- rate limiting (ADR-031) -------------------------------------------------
# Last in the file: these deliberately exhaust an allowance, and the per-address
# counter is shared with everything above.
guess() { curl -sS -o /tmp/smoke-body -D /tmp/smoke-head -w '%{http_code}' \
  -X POST "${json[@]}" -d "{\"email\":\"$1\",\"password\":\"wrong-password-here\"}" \
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
# was her email and not the address.
[ "$(guess dave@example.com)" = "401" ] && pass "another account is unaffected" \
  || fail "the per-account limit locked out an unrelated account"

# Now the address limit. Every email here is new, so the per-account limiter
# cannot be what answers — its counter for each is untouched.
TRIPPED=""
for i in $(seq 1 30); do
  [ "$(guess "burst$i@example.com")" = "429" ] && { TRIPPED=$i; break; }
done
[ -n "$TRIPPED" ] && pass "a burst of distinct accounts is refused after $TRIPPED from one address" \
  || fail "the per-address limit never bit in 30 attempts"

echo; echo "  all good"
