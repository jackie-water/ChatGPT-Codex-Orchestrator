# Immutable implementation evidence: Control #351

Project: orchestrator-dev; route: chat-333; logical iteration: 14/14.
Exact source commit: 8fc87d30ddad622372c986501ba574a8e5b8d6b2
Predecessor: d7401c2c821ad3982a21001dc847fcc6f8ff266a
Task branch: feat/macos-short-turn-autoloop-20261018
Codex local Mac CLI exit: 0. Executor log SHA256: dc3052903a66007cafbffc0cd48da490ce14ad553c4d519b2298691f9e2b77f2
Changed ONLY src/lib/macos-short-turn-autoloop.mjs and tests/macos-short-turn-autoloop.test.mjs.

## Independent wrapper (FAIL)
Focused 22 total, 20 PASS, 2 FAIL; log SHA256 08a39e2532d8d8433d303abfc50b24be3d597ea9dc4625a2ad9f57e2963ef0ef.
Full default 447 total, 435 PASS, 2 FAIL, 10 SKIP; log SHA256 92f5a28622a1189a44a94cd9a031133c6b1a29ab958b3f00ad1cb81ec24223ff.
Full serial 447 total, 435 PASS, 2 FAIL, 10 SKIP; log SHA256 e8d427317e4728976d460da5e7823cd7be4d98c55c91056daaeacc178db315ea.
Both assertion failures expect UNTRUSTED_ROUTE_REGISTRY; privateDir/privateFile rejects with UNTRUSTED_SCOPE_AUTHORITY. No unsafe route accepted in these cases.
Independent disposable HOME replays: symlinked root/instances/instance rejected, symlinked pending-wakes and receipt leaf rejected without CLAIMED, valid private receipt CLAIMED. Probe SHA256 dbdaa513c68e916530937aa8069739c62026f70719217853d90b265b63e04601.
Local adjudication SHA256 f55958596ea357d0b847ca481b45249c3bf84a333eafb7eff057e4a27711e488.

## Gate
Chat: NEEDS_HUMAN. Remote exact task SHA verified, worktree clean. 14/14 budget exhausted.
No exact SHA independent Code Review (wrapper FAIL); no merge, signer provisioning, runtime bundle, Controller, Runner, browser, Sandbox or target activation.
Original #332 remains unstarted and pinned to chat-303; native PID 500ms and other protected projects untouched.