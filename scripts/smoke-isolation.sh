#!/usr/bin/env bash
# Live isolation attacks against a deployed environment seeded with the demo data
# (SEED_DEMO=true). Usage: scripts/smoke-isolation.sh https://appstage-xxxx.zerops.app
set -u; cd "$(mktemp -d)"
U=$1; P='Demo-Pass-2026!'; pass=0; fail=0
H=(-H 'content-type: application/json' -H "origin: $U")
login(){ curl -s -c "$1.jar" "${H[@]}" -X POST "$U/api/auth/login" -d "{\"email\":\"$2\",\"password\":\"$P\"}" >/dev/null; }
code(){ curl -s -o /dev/null -w '%{http_code}' "${H[@]}" "$@"; }
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1 → $2"; pass=$((pass+1)); else echo "FAIL  $1 → got $2, want $3"; fail=$((fail+1)); fi; }
login bob bob@acme.test; login dana dana@globex.test; login carol carol@acme.test
GP=$(curl -s -b dana.jar "$U/api/projects" | python3 -c 'import sys,json;print(json.load(sys.stdin)["projects"][0]["id"])')
GORG=$(curl -s -b dana.jar "$U/api/me" | python3 -c 'import sys,json;print(json.load(sys.stdin)["activeOrgId"])')
FRANK=$(curl -s -b dana.jar "$U/api/members" | python3 -c 'import sys,json;print([m["id"] for m in json.load(sys.stdin)["members"] if m["email"].startswith("frank")][0])')
BOBID=$(curl -s -b bob.jar "$U/api/me" | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')
check "bob(acme) GET globex project by id"        $(code -b bob.jar "$U/api/projects/$GP") 404
check "bob PATCH globex project"                  $(code -b bob.jar -X PATCH "$U/api/projects/$GP" -d '{"name":"pwned"}') 404
check "bob DELETE globex project"                 $(code -b bob.jar -X DELETE "$U/api/projects/$GP" -d '{}') 404
check "bob switch session into globex"            $(code -b bob.jar -X POST "$U/api/session/active-org" -d "{\"orgId\":\"$GORG\"}") 403
check "bob forged X-Org-Id header"                $(code -b bob.jar -H "x-org-id: $GORG" "$U/api/projects") 409
check "bob change globex member role"             $(code -b bob.jar -X PATCH "$U/api/members/$FRANK" -d '{"role":"admin"}') 404
check "bob remove globex member"                  $(code -b bob.jar -X DELETE "$U/api/members/$FRANK" -d '{}') 404
curl -s -b bob.jar "$U/api/projects?orgId=$GORG" | grep -q Brand && check "bob ?orgId=globex leaks" leak none || check "bob ?orgId=globex ignored" none none
check "carol(member) invite someone"              $(code -b carol.jar -X POST "$U/api/invitations" -d '{"email":"x@y.io","role":"member"}') 403
check "carol(member) promote bob→member"          $(code -b carol.jar -X PATCH "$U/api/members/$BOBID" -d '{"role":"member"}') 403
check "carol(member) delete org"                  $(code -b carol.jar -X DELETE "$U/api/org" -d '{"confirm":"acme"}') 403
check "carol(member) read audit log"              $(code -b carol.jar "$U/api/audit") 403
check "bob(admin) delete org"                     $(code -b bob.jar -X DELETE "$U/api/org" -d '{"confirm":"acme"}') 403
check "cross-site POST (CSRF)"                    $(curl -s -o /dev/null -w '%{http_code}' -b bob.jar -H 'content-type: application/json' -H 'origin: https://evil.example' -X POST "$U/api/projects" -d '{"name":"x"}') 403
check "no cookie → projects"                      $(code "$U/api/projects") 401
curl -s -b carol.jar "${H[@]}" -X POST "$U/api/auth/logout" -d "{}" -o /dev/null -w "logout %{http_code}\n"
check "revoked (logged-out) cookie reused"        $(code -b carol.jar "$U/api/me") 401
echo "--- $pass passed, $fail failed"
