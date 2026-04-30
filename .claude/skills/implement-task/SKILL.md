---
name: implement-task
description: >
  Implements a specific task from tasks.md end-to-end and verifies its Definition of Done.
  Use this skill whenever the user says /implement-task, "implement task T-XX", "work on T-XX",
  "do task XX", or refers to a task number from the project task list. Always invoke this skill
  when a task ID (like T-11, T-27, 48) is mentioned alongside intent to implement or complete it.
---

# implement-task

Implement a task from `tasks.md` fully and verifiably — not just write the code, but confirm every Definition of Done criterion is satisfied before declaring it complete.

## Step 1 — Parse the task ID

`$ARGUMENTS` contains the task reference. Normalize it: bare numbers like `27` become `T-27`; hyphenated variants like `T-41-servers` are used as-is. If `$ARGUMENTS` is empty, ask the user which task to implement.

## Step 2 — Read the task

Open `tasks.md` and locate the section for the normalized task ID. Extract:
- **Description** — what to build and why
- **Deps** — prerequisite task IDs
- **Definition of Done** — the exact checklist you must satisfy

If the task ID is not found, tell the user and stop.

## Step 3 — Check dependencies

For each task ID listed under Deps, look for evidence in the repo that it is already implemented (relevant files, endpoints, schemas, generated stubs, etc.). If a hard dependency is clearly absent, tell the user which dep is missing and stop — implementing on a missing foundation produces broken code.

## Step 4 — Plan before coding

Before touching any file, write 3–5 bullet points covering:
- Which files you will create or modify
- The libraries/frameworks you will use (match the service's existing stack)
- Any non-obvious design decisions

Keep this brief. Its purpose is to let you catch mistakes before they are baked into code.

## Step 5 — Implement

Write the code, configuration, migrations, tests, or documentation the task requires. Follow the conventions of the service directory you are working in — language idioms, file layout, naming patterns, test framework. Do not add features, abstractions, or cleanup beyond what the Description and DoD require. Do not add explanatory comments; only comment when the *why* is non-obvious.

## Step 6 — Verify every DoD item

Go through each DoD criterion one by one. For each one:

1. State the criterion.
2. Run the concrete command it describes if you can (build, test, curl, lint, grpcurl, etc.).
3. Mark it **✅ PASS** or **❌ FAIL** with a one-line explanation of the evidence.

If a criterion requires a live environment (running Docker stack, real database, browser, hardware microphone), implement the code correctly and mark that criterion as **⚠️ NEEDS LIVE ENV**. Tell the user to bring up the full stack with:

```
docker-compose --env-file infra/.env -f infra/docker-compose.yml up --build
```

Never attempt to start individual services or components in isolation — partial stack runs produce misleading errors (missing dependencies, wrong env, port conflicts) and waste the user's time. If verification needs a running service, the answer is always the full stack command above, not a one-off `go run`, `uvicorn`, `cargo run`, etc.

## Step 7 — Report the outcome

- **All items ✅** → declare the task **DONE** and give a one-paragraph summary of what was built.
- **Any item ❌** → fix the failures and re-verify until all pass.
- **Only ⚠️ items remain** → declare the task **IMPLEMENTED — MANUAL VERIFICATION NEEDED** and list exactly what the user must run to close the gap.

## Important constraints

- Never declare DONE unless every DoD criterion is either ✅ PASS or explicitly ⚠️ NEEDS LIVE ENV.
- Prefer editing existing files over creating new ones.
- If the task's DoD references a command, run it — do not assume it will pass.
- Never start the project or any individual service in isolation (no `go run`, `uvicorn`, `cargo run`, `npm run dev`, `java -jar`, etc.). Starting components alone produces spurious errors due to missing dependencies. If the verification needs a live environment, tell the user to run the full stack with `docker-compose --env-file infra/.env -f infra/docker-compose.yml up --build` and mark the criterion ⚠️ NEEDS LIVE ENV.
