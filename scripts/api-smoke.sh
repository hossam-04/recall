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

DATABASE_URL="$DB" PORT="$PORT" npm run start --silent >/tmp/smoke-server.log 2>&1 &
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
grep -q '"intervalDays":1' /tmp/smoke-body && pass "first good -> 1 day" || fail "wrong interval: $(cat /tmp/smoke-body)"
# shellcheck disable=SC2086
expect 201 "grade: good again" -X POST "${json[@]}" $CSRF_A -d '{"grade":"good"}' -b "$JAR_A" "$BASE/api/cards/$CARD/reviews"
grep -q '"intervalDays":6' /tmp/smoke-body && pass "second good -> 6 days" || fail "wrong interval: $(cat /tmp/smoke-body)"

REVIEWS=$(psql "$DB" -tAc "select count(*) from reviews")
[ "$REVIEWS" = "2" ] && pass "both reviews were recorded as events (ADR-010)" || fail "expected 2 review rows, got $REVIEWS"

expect 201 "bob registers"  -X POST "${json[@]}" -d "$B" "$BASE/api/users"
expect 201 "bob logs in"    -X POST "${json[@]}" -d "$B" -c "$JAR_B" "$BASE/api/sessions"
expect 403 "bob is refused alice's deck" -b "$JAR_B" "$BASE/api/decks/$DECK"
expect 200 "bob's own deck list is empty" -b "$JAR_B" "$BASE/api/decks"
[ "$(cat /tmp/smoke-body)" = "[]" ] && pass "and it really is empty" || fail "bob sees $(cat /tmp/smoke-body)"

expect 204 "alice logs out" -X DELETE -b "$JAR_A" "$BASE/api/sessions"
expect 401 "her cookie stops working" -b "$JAR_A" "$BASE/api/decks"

echo; echo "  all good"
