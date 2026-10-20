# Immutable independent cumulative Code Review and Chat adjudication — Control #403

Project: orchestrator-dev
**Exact originating registered review_route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact reviewed source SHA: 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7**
Full cumulative C2 + Trusted Recovery Evidence v1 review base: 7e03521158db16731801e55803dbb8c870f5288c.
Implementation issue #402, one-time human-approved REVISE **19/19**.
Pinned immutable implementation checkpoint commit: **2691cae62c7637206540611f08909482263b151c**
Implementation report: `.codex/runs/by-issue/402/iteration-19__34657fb9a0bf.md`, read back from its exact checkpoint. Prior #401 review belongs ONLY to predecessor SHA c6240b42d699250aa814379d593eea252ce99366 and may not substitute.

## Independent read-only full cumulative exact-SHA Code Review

A SINGLE independent Codex CLI read-only Code Review inspected the FULL CUMULATIVE diff from base 7e03521158db16731801e55803dbb8c870f5288c to the exact source SHA above on MacBook-Air.local. Review exit=0, timed_out=false, elapsed **100.51 seconds**, full log 529558 bytes, SHA256 **f1bbc43fdb7aed30f3858add5c4559bf34a1e7c4bc8fe5aed9c0da408155e7eb**. Source HEAD stayed 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7, task worktree remained clean, full cumulative diff SHA256 **383063de3f451210dcc5b4a7188116ec732bf0687913407d6155bc541ee258b1**. The reviewer did not commit, push or merge source. Raw review log and independent confirmation reside temporarily at `/tmp/trusted-recovery-review-403-private/`.

Exact-source independent implementation wrapper PASS:
- Scope/syntax/diff: only `src/lib/macos-trusted-recovery-evidence.mjs` and `tests/macos-trusted-recovery-evidence.test.mjs`.
- Focused **170/170 PASS**, log SHA256 f1fd76a963cd231591fb5c0baeb39d00beffe56833663cc46d650b37596405a4.
- Full default **502 total / 492 PASS / 0 FAIL / 10 SKIP**, log SHA256 7e5a892f8acee7102f3db2ee9d6e58b9fa640e674d5c9e3381032e0ad342aadf.
- Full serial **502 total / 492 PASS / 0 FAIL / 10 SKIP**, log SHA256 f3ab594ff7cdd5d250cbbff6909a5563468ed723b79961a3962df685779f2063.
- Private independent HOME safety probes **34/34 PASS**, including 0600 receipt VERIFIED, 0700 receipt CONFLICT and issuer denial, 3 other receipt tamper denials, wrong-instance/legacy/symlink/duplicate route/Chat URL tamper denial. Consolidated proof SHA256 b1aab6919c3a4d93338897ea953885bba7fcdf9400cbee9e8c08795dcc922b61.
- Wrapper SHA256 e744d77483ed638b55a8c8af517c183a014a46af59ed0316ec3a16f8a095e2b3, immediate delta SHA256 627d6cc8ea8a0b27bafce848c4321b4d8435b6567268158c03b29716a5af6b04.

These positive results validate the requested receipt permission correction. They do **not** override cumulative Code Review findings. Native Helper executable mode 0700 remains legitimate, unchanged and outside this patch.

## One reviewer P2 — Chat independently CONFIRMED

**[P2] Malformed records in the route registry are silently discarded instead of invalidating trusted recovery.**
Exact source: `src/lib/macos-trusted-recovery-evidence.mjs` at `routeRecords()`, around lines 166–169:
```js
function routeRecords(value) {
  const routes = Array.isArray(value?.routes) ? value.routes :
    value?.routes && typeof value.routes === "object"
      ? Object.entries(value.routes).map(([route, record]) => ({ route, ...record }))
      : [];
  return routes.filter(record => safeId(record?.route));
}
```
The parser's `.filter()` drops a raw active route whose `route` is malformed or missing without reporting an error. The subsequent checks test the selected known route and uniqueness against only this **filtered** collection. Therefore a corrupted route file containing one valid route and additional malformed route records can still satisfy the issuer and read-only verifier and return `VERIFIED`, contrary to Trusted Recovery Evidence v1's explicit fail-closed contract for malformed/tampered local route evidence.

**Independent Chat validation:** a private canonical disposable Mac HOME with synthetic distinct private GitHub Control/Sandbox repositories and independently authored registration Issue was created. In a first fixture, added one record with malformed `route: "../foreign"` and otherwise active Sandbox project metadata before receipt issuance, retaining a valid `chat-369` record: `issueTrustedRecoveryEvidence()` still issued a `VERIFIED` receipt. In a second fixture, issued an authentic `VERIFIED` receipt, then added an active Sandbox record missing the `route` field: `verifyTrustedRecoveryEvidence()` still returned `VERIFIED` with no missing gates and idempotent `issueTrustedRecoveryEvidence()` also returned `VERIFIED`. Normal active Chat URL tampering was correctly denied (prior 34-case suite), so this is a *separate integrity weakness*; it is NOT evidence of an observed real callback misdelivery.

Independent raw proof SHA256 **e7f901208febaeffc1c6ddb305a8512e136e6ccfe1d1ef2cea1906bed649a47b**, stored at `/tmp/trusted-recovery-review-403-private/independent-malformed-route-probe.json`. Synthetic HOME deleted, no real GitHub/network or actual installation touched. This confirms P2; it is not a reviewer false positive.

**Required narrowly scoped correction IF separately user-authorized:** fail closed on any malformed route registry entry rather than silently dropping it. Validate every raw route record before selecting and checking unique active route/project/issue/Chat URL, including array and map formats; absent/malformed `route`, malformed record value and prohibited route name must yield `CONFLICT` before receipt verification or issuance. Preserve positive normal route parsing, case-specific pre-issuance ABSENT/NEEDS_HUMAN_LEGACY behavior, exact GitHub Issue/Chat URL, no fallback, and all native Helper PID/mode, file permission, owner/symlink/repo identity rules. Add a canonical private HOME positive and two negative before/after-issued route integrity tests. User authorization is needed for a single new 20/20; not automatically authorized.

## Final Chat adjudication and safety boundaries

**NEEDS_HUMAN / WAITING_HUMAN; NOT PASS and NOT MERGE-READY.**
The one-time explicit user-authorized 19/19 iteration has been consumed. Do not automatically create 20/20 or a duplicate independent Code Review for unchanged SHA; never merge absent explicit user approval of a separately PASS-reviewed exact SHA. This report is immutable evidence for next session.

NO merge, official installer, old-instance migration/adoption, native signer, Runner/LaunchAgent/browser/CDP, Sandbox merge, real target activation, protected main/dev, Windows, Priceup, Clean Energy or old Phase B actions. Workflow remains manually disabled and runner count 0 unless independently reverified later.
