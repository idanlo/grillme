# CI quality gates

The CI workflow covers only the local Grillme product:

- build the server bundle;
- build the local browser client;
- verify `grillme --help` from the generated bundle;
- run the client, contracts, and shared-runtime tests.

There are no native, desktop, mobile, relay, or cloud jobs. Local development should use the smallest focused command for the package being changed; the full repository suite remains CI-owned.
