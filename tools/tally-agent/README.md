# Tally connector

The program that runs on the Windows PC where Tally is installed. It reads
masters out of Tally, sends them to the operations API, and writes back masters
created here.

**Setting it up on a customer's machine:** see [../../docs/tally-setup.md](../../docs/tally-setup.md).
That guide is written for the person doing the install, not for a developer.

## Building the deliverable

```
pnpm build:agent
```

Produces `dist/tally-agent.cjs` — one file, no dependencies, no `npm install`
on the target machine. Copy it to the Windows PC and run it with Node 20+.

Bundling everything is deliberate: the machine that runs Tally is often on a
restricted network with no access to a package registry, and asking an
accountant to run `npm install` is asking for a support call.

## Running it here

```
pnpm --filter @attendance/tally-agent start
```

Configuration comes from `tally-agent.json` beside the executable, or from
environment variables, which win:

| Variable | Config key |
| --- | --- |
| `TALLY_AGENT_API_URL` | `apiUrl` |
| `TALLY_AGENT_SECRET` | `agentSecret` |
| `TALLY_AGENT_COMPANY` | `company` |
| `TALLY_AGENT_TALLY_URL` | `tallyUrl` |
| `TALLY_AGENT_POLL_SECONDS` | `pollSeconds` |
| `TALLY_AGENT_STATE_DIR` | `stateDir` |
| `TALLY_AGENT_WRITE_BACK` | `writeBack` |
| `TALLY_AGENT_CONFIG` | — path to the config file itself |

## How it is laid out

| File | What it holds |
| --- | --- |
| `src/agent.ts` | The sync pass and the loop around it. |
| `src/config.ts` | Configuration, and the messages shown when it is wrong. |
| `src/queue.ts` | The on-disk outbox and the per-entity watermarks. |
| `src/log.ts` | Timestamped output, and translation of network errors into English. |
| `src/main.ts` | The entry point, separate so tests can import the agent without starting it. |

The XML — building requests, parsing collections, writing masters — lives in
`packages/shared/src/tally-xml.ts` rather than here, so it can be tested on any
machine. A parser that only runs where Tally is installed is a parser nobody
tests.

## The rules it is built on

Each of these exists because of a specific way a connector fails in the field:

- **Nothing read from Tally is sent before it is written to disk.** Tally's
  AlterID moves on regardless; a batch lost to a dropped connection is a change
  nobody can find again.
- **Tally being closed is not an error.** It is closed every evening. Said once,
  then quietly retried.
- **The heartbeat goes out even when Tally is unreachable**, carrying
  `tallyReachable`, so the status screen can tell "the connector is dead" from
  "Tally is closed".
- **A batch the server permanently refuses is dropped, not retried forever.**
  Otherwise one bad batch blocks every batch behind it and the sync stops
  without appearing to.
- **A batch refused for a fixable reason (a bad secret) is kept.** That is a typo
  in a config file, not a reason to lose data.
- **It never exits on an error it might recover from.** A connector that stops at
  2am is a connector nobody notices until the month-end close.
- **It refuses to start on its own template.** Every placeholder is
  syntactically valid, so without that check it runs against `example.com`,
  reports no errors, and nobody finds out until month end.
