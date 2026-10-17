# macOS libproc process-identity spike

## Feasibility result

Observed on 2026-10-17 (Australia/Melbourne) on this Mac:

- `Darwin MacBook-Air.local 27.0.0 ... RELEASE_ARM64_T8142 arm64`.
- Apple Command Line Tools were available at `/Library/Developer/CommandLineTools`.
- `xcrun --find clang` resolved to `/Library/Developer/CommandLineTools/usr/bin/clang`.
- The MacOSX SDK exposed `usr/include/libproc.h` and `usr/include/sys/proc_info.h`.
- The SDK declared `proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)`, `PROC_PIDTBSDINFO=3`, and `struct proc_bsdinfo.pbi_start_tvsec` / `pbi_start_tvusec` as `uint64_t`.

The standalone helper was compiled with Apple's `xcrun --sdk macosx clang`, `-std=c11 -Wall -Wextra -Werror`, and the SDK sysroot. It calls `proc_pidinfo` with `PROC_PIDTBSDINFO`, passes the full `sizeof(struct proc_bsdinfo)`, requires `0 <= usec < 1000000`, and emits exactly one JSON record. The source is [process_identity.c](../runtime/native/macos/process_identity.c); no executable is committed.

The temporary `0700` helper returned these records during the proof run:

```text
current process:  {"status":"OK","pid":32740,"start_sec":1792231843,"start_usec":243316}
known live PID:   {"status":"OK","pid":32612,"start_sec":1792231819,"start_usec":497224}
invalid PID 0:    {"status":"INVALID_PID","pid":0,"errno":22}  exit 64
missing PID:      {"status":"MISSING","pid":2147483647,"errno":3}  exit 66
```

This proves operational success separately from SDK field presence. It also proves the identity contains microseconds. It does not prove that every future process is readable: `EPERM`/`EACCES`, short reads, malformed timestamps, and unexpected errors remain explicit failure outcomes and never mean “live”.

## Source build and isolated proof

From the repository root on an authorized Mac:

```sh
tmpdir="$(mktemp -d /private/tmp/libproc-spike.XXXXXX)"
chmod 700 "$tmpdir"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
xcrun --sdk macosx clang -std=c11 -Wall -Wextra -Werror -isysroot "$sdk" \
  runtime/native/macos/process_identity.c -o "$tmpdir/process-identity"
chmod 700 "$tmpdir/process-identity"
"$tmpdir/process-identity" "$$"
```

The helper is intentionally source-only in this repository. It is not installed globally, compiled from an event, or invoked through a shell. A packaged installation must place a vetted copy in a private, owner/root-owned, non-group/world-writable directory and verify its mode before use.

## Node boundary and durable intake

`src/lib/macos-native-process-identity.mjs` is a pure parser/runner boundary. It accepts only a positive decimal PID, invokes the trusted helper with one fixed argv element, uses a finite timeout and fixed environment, and rejects extra output, wrong PIDs, unsafe numeric values, invalid microseconds, and all unknown statuses.

The Darwin intake integration is opt-in through `ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY=1`. With that flag, an absent, unreadable, invalid, or untrusted helper fails closed before a new intent is accepted with an actionable `NATIVE_PROCESS_IDENTITY_HELPER_UNAVAILABLE`/owner-identity error; it never falls back silently or claims the owner is live. If the helper disappears after acceptance, the worker/receipt recovery path records an actionable `UNKNOWN` outcome without rerunning Codex. Without the flag, existing stable Darwin behavior is unchanged. Linux and Windows paths are not changed.

The existing durable rules remain authoritative: exact start-identity equality is required, PID reuse is ambiguous/not live, missing owner is dead only when the kernel reports `ESRCH`, permission denial is unknown, terminal receipt states are monotonic, claims and receipt locks remain exclusive, and an uncertain lock is never deleted as though it belonged to another owner.

Receipt-lock recovery is fail-closed. Even after an observed owner PID returns `ESRCH`, standard Node filesystem APIs cannot atomically unlink only the lock entry that was observed; another writer may have replaced that pathname. The intake therefore preserves the lock and receipt and returns `RECEIPT_LOCK_RECLAIM_UNCERTAIN` with actionable recovery guidance. An operator must establish that no writer remains, preserve/inspect the receipt, and remove the lock through the deployment's reviewed recovery procedure before retrying. This path never converts ambiguity into `UNKNOWN`, dispatches a duplicate worker, or deletes a replacement lock.

## Official packaging proposal (not applied)

The official macOS installer should add a prerequisite step before enabling any native-identity opt-in:

1. Verify Apple CLT and the MacOSX SDK with `xcrun`; report a distinct prerequisite action if absent.
2. Install/build the reviewed helper into the installer-owned private runtime directory with mode `0700` (or a `0700` parent and `0700` executable), never into a global PATH.
3. Verify owner, regular-file status, non-writable group/other bits, and a recorded package/source digest.
4. Run the helper against the installer process and one independently selected live PID; require full-schema success and distinct microsecond-capable identities.
5. Persist an explicit capability result. If any check fails, keep legacy stable operation available but do not enable native identity, and surface an actionable status for the operator.
6. Only after those checks should the official runtime opt into `ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY=1`.

This proposal is deliberately documented rather than applied: `Install.command`, `install.sh`, CI, and `AI_INSTALL.md` were not modified in this spike. The installer must preserve the existing explicit-route-v1, `PROJECT_DISABLED`, exact-SHA review, and user-approved merge gates.

## Remaining architecture decision

The kernel/helper feasibility is **PASS** for this Mac and the isolated parser is testable. Official packaging is **NEEDS_HUMAN** until the project owner chooses the signed/private helper distribution and installer capability-record format. This spike does not deploy, activate, merge, or claim package readiness.
