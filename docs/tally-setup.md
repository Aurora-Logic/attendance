# Connecting Tally

This is the whole setup, start to finish, for the Windows PC where Tally runs.
Allow about twenty minutes. You do not need to be a developer, but you do need
to be able to log in to that PC as an administrator.

**What you end up with:** customers, vendors, stock items and ledgers flowing
from Tally into the operations system automatically, and masters created here
flowing back into Tally.

**What is deliberately *not* connected:** attendance and payroll. They stay in
this system and never touch your books. Nothing in this guide gives the
connector any access to vouchers, salaries or attendance data.

---

## 1. Why a connector is needed at all

Tally's XML gateway only listens on the machine Tally is installed on, only
while Tally is open, and only on the local network. A server on the internet
cannot reach it — not because of a setting, but by design.

So a small program (the *connector*) runs on that Windows PC. It talks to Tally
locally over the LAN and to this system over HTTPS. It also means that when
Tally is closed for the evening, or the broadband drops, nothing is lost — the
connector holds changes on disk and sends them when things come back.

```
  Windows PC (accounts room)                    Your server
  ┌──────────────────────────┐                 ┌──────────────┐
  │  Tally  ◄──── XML ────►  │ ──── HTTPS ───► │  Operations  │
  │  :9000       connector   │                 │    system    │
  └──────────────────────────┘                 └──────────────┘
```

---

## 2. Turn on Tally's XML gateway

Do this in Tally on the PC where the company data lives.

**Tally Prime**

1. From the Gateway of Tally press <kbd>F1</kbd> → **Settings**.
2. Choose **Connectivity**.
3. Set **Client/Server configuration** to `Both` (or `Server`).
4. Set **Port** to `9000`.
5. Press <kbd>Ctrl</kbd>+<kbd>A</kbd> to accept.

**Tally ERP 9**

1. Press <kbd>F12</kbd> → **Advanced Configuration**.
2. Set **Tally is acting as** to `Both`.
3. Set **Port** to `9000`.
4. Accept.

**Check it worked.** Open a browser *on that same PC* and go to
<http://localhost:9000>. You should see a short XML page mentioning
TallyPrime — not "site cannot be reached". If it fails, Tally is not running,
or the setting above did not save.

> **Leave the company open.** The gateway only answers for a company that is
> currently loaded. If Tally is running with no company open, the connector will
> report `No company is open` and wait.

---

## 3. Install Node

The connector needs Node.js 20 or newer.

1. Download the **LTS** Windows installer from <https://nodejs.org>.
2. Run it and accept the defaults.
3. Open Command Prompt and check:

   ```
   node --version
   ```

   It should print `v20.` or higher.

---

## 4. Install the connector

1. Create a folder, e.g. `C:\TallyConnector`.
2. Copy `tally-agent.cjs` into it. That single file is the entire connector —
   there is nothing to install and no internet access needed for it.
3. Open Command Prompt in that folder and run:

   ```
   node tally-agent.cjs
   ```

   The first run writes a template `tally-agent.json` next to it and stops.

4. Open `tally-agent.json` in Notepad and fill it in:

   ```json
   {
     "apiUrl": "https://operations.yourcompany.com",
     "agentSecret": "the value of TALLY_AGENT_SECRET from the server",
     "company": "Your Company Name As Shown In Tally",
     "tallyUrl": "http://localhost:9000",
     "pollSeconds": 60,
     "writeBack": true
   }
   ```

   | Field | What it is |
   | --- | --- |
   | `apiUrl` | Address of this operations system. Must be `https://` unless it is on this same machine. |
   | `agentSecret` | Must match `TALLY_AGENT_SECRET` on the server exactly. Ask whoever runs the server. |
   | `company` | The company name **exactly** as Tally shows it, spaces and all. A mismatch is refused rather than merged. |
   | `tallyUrl` | Leave as is unless Tally is on a different port. |
   | `pollSeconds` | How often to check Tally. 60 is a good default; the minimum is 10. |
   | `writeBack` | `false` makes the connector read-only — useful for the first week if you want to watch before letting anything write into your books. |

5. Run it again:

   ```
   node tally-agent.cjs
   ```

   You should see something like:

   ```
   08/08/2026, 14:02:11  Tally connector 1.0.0
   08/08/2026, 14:02:11    Company : Delta Traders
   08/08/2026, 14:02:12  Read 214 changed master(s) from Tally.
   08/08/2026, 14:02:13  Sent 214 master(s) — 214 applied, 0 conflict(s)
   ```

   Leave it running and check **Settings → Tally** in the web app. The connector
   should show as **Live**.

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop it. Anything not yet sent stays on
disk and goes out on the next start.

---

## 5. Keep it running — install as a Windows service

A Command Prompt window closes when somebody logs out. For day-to-day use the
connector should be a service, so it starts with the PC and restarts itself if
it ever stops.

### Option A — NSSM (recommended)

1. Download NSSM from <https://nssm.cc/download> and unzip it.
2. From an **Administrator** Command Prompt, in the `win64` folder:

   ```
   nssm install TallyConnector
   ```

3. In the window that opens:
   - **Path**: `C:\Program Files\nodejs\node.exe`
   - **Startup directory**: `C:\TallyConnector`
   - **Arguments**: `tally-agent.cjs`
   - On the **I/O** tab, set **Output (stdout)** and **Error (stderr)** to
     `C:\TallyConnector\connector.log` so there is a log to read later.
   - On the **Exit actions** tab, leave the default restart behaviour.
4. Click **Install service**, then start it:

   ```
   nssm start TallyConnector
   ```

To see how it is doing: `nssm status TallyConnector`, or open
`C:\TallyConnector\connector.log`.

### Option B — Task Scheduler (no extra download)

1. Open **Task Scheduler** → **Create Task**.
2. **General**: name it `Tally Connector`. Select **Run whether user is logged
   on or not** and **Run with highest privileges**.
3. **Triggers**: New → **At startup**. Tick **Repeat task every 5 minutes** for
   **Indefinitely**, so it comes back if it ever exits.
4. **Actions**: New → Start a program.
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `tally-agent.cjs`
   - Start in: `C:\TallyConnector`
5. **Settings**: tick **If the task fails, restart every 1 minute**.

> Task Scheduler gives you no log by default. NSSM is worth the download.

---

## 6. Windows Firewall

**Usually nothing to do.** The connector makes *outbound* HTTPS connections and
talks to Tally on `localhost` — neither needs an inbound rule, and Windows
Firewall allows outbound traffic by default.

You only need to touch the firewall if:

- **Tally is on a different PC** on the LAN. Then, on the *Tally* machine, allow
  inbound TCP on port 9000 **from the local subnet only**:

  ```powershell
  New-NetFirewallRule -DisplayName "Tally XML (LAN only)" -Direction Inbound `
    -Protocol TCP -LocalPort 9000 -RemoteAddress LocalSubnet -Action Allow
  ```

  Set `tallyUrl` in the config to `http://<that-pc-name>:9000`.

- **Outbound traffic is restricted** by a corporate firewall or proxy. Allow
  outbound HTTPS (443) from the connector PC to your server's address.

> **Never forward port 9000 through your router.** Tally's gateway has no
> authentication of any kind. Anyone who can reach it can read and write your
> books. It belongs on the LAN and nowhere else.

---

## 7. What to expect day to day

| What you see | What it means | What to do |
| --- | --- | --- |
| **Live** in Settings → Tally | Heartbeat within the last 10 minutes. | Nothing. |
| **Live**, "Tally not reachable" | Connector is fine; Tally is closed or has no company open. | Normal after hours. If it is during the day, open Tally. |
| **Stale** | No heartbeat for over 10 minutes. | The PC is off, or the service stopped. Check `connector.log`. |
| **Never connected** | It has not run successfully even once. | Work back through sections 4 and 5. |
| Records queued | Changes read from Tally that this server has not accepted yet. | Usually the internet. It clears itself; nothing is lost. |

### Conflicts

If a customer is edited **in both places between two syncs**, the more recent
edit wins and the other copy is kept in **Settings → Tally → Conflicts**, in
full, so you can see exactly what was overwritten and put it back by hand if it
mattered. A one-sided edit is never a conflict, so this list stays short enough
to actually read.

---

## 8. When something is wrong

| Message in the log | Cause | Fix |
| --- | --- | --- |
| `Nothing is listening at that address` | Tally is closed, or the XML port is off. | Section 2. |
| `No company is open` | Tally is running with no company loaded. | Open the company in Tally. |
| `The server rejected the agent secret` | `agentSecret` does not match the server. | Copy `TALLY_AGENT_SECRET` from the server again — no quotes, no trailing spaces. |
| `registered against a different company` | `company` does not match what the server first saw. | Correct the spelling, or have the server's company setting cleared. |
| `That address could not be resolved` | `apiUrl` is misspelt, or this PC has no internet. | Check the address in a browser on that PC. |
| `certificate could not be verified` | The server is using a self-signed certificate. | It needs a real one. The connector will not skip verification — the agent secret would be exposed. |
| `master(s) had no GUID` | Rare; a master Tally exported without an identifier. | It is skipped rather than matched by name, which would merge two customers. Re-saving that master in Tally usually fixes it. |

### Starting over

Stop the service, delete the `state` folder next to `tally-agent.cjs`, and start
it again. The connector re-reads everything from Tally. This is safe — it is
slower, not destructive.

---

## 9. Security notes

- The agent secret is the only credential; it is sent as a header over HTTPS and
  never written to the log.
- The connector never reads vouchers, attendance, or payroll — only masters.
- Keep the secret out of the config file if you prefer: set it as a system
  environment variable named `TALLY_AGENT_SECRET` instead, and the connector
  will use that in preference to the file.
- On the server, `TALLY_AGENT_SECRET` must be at least 32 characters in
  production; the API refuses to start otherwise. Generate one with
  `openssl rand -base64 48`.
