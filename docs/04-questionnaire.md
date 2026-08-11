# 04 — Discovery Questionnaire

Answer by number. Write **"default"** for anything you don't have a strong view on and the assumed value in *(italics)* will be used. Write **"skip"** if a question doesn't apply to your setup.

Sections marked **[BLOCKER]** must be answered before that phase can start.

---

## A. Organisation and scale **[BLOCKER — Phase 0]**

1. Legal entity name, and the name you want on the product / login screen.
2. Is this one company, or will you eventually run more than one entity in the same system?
3. Total headcount today. Split by category if it varies (office staff, factory/shop floor, field staff, contract labour).
4. Expected headcount in two years.
5. How many physical locations? Name each one.
6. For each location: rough headcount, and does it have its own shift timings and holiday list?
7. Is anyone working fully remote or permanently off-site?
8. Do you employ contract labour through a contractor? If yes, do they punch in this system too, and are their rules different?
9. Do you have interns, apprentices, or trainees with different attendance or leave rules?

## B. Employee data

10. What is your employee code format? (e.g. `GC-0142`, or plain numbers)
11. Do employee codes already exist, or does this system assign them?
12. Which fields must exist on an employee record beyond the standard set (name, code, joining date, department, designation, location, manager, shift)? Examples people often want: blood group, emergency contact, PAN, Aadhaar reference, bank reference, UAN, photo, address, date of confirmation, probation end date.
13. Any field that must be **restricted** — visible to HR/Admin only, not to managers?
14. Do you need a document store per employee (contracts, ID copies, certificates)? *(default: not in this phase)*
15. Is there an existing employee list I should design the bulk-import template around? If so, share the sheet — the template should match your columns, not the other way round.
16. Do you track probation, and does probation change attendance or leave rules?
17. Do you need a "notice period / exit" state, or is deactivation on a last working date enough?

## C. Shifts and rosters **[BLOCKER — Phase 1]**

18. List every shift you run: name, start time, end time, break duration.
19. Any shift crossing midnight? If yes, which.
20. Is a person's shift generally fixed, or rotating? If rotating, on what cycle (weekly, monthly, ad hoc)?
21. Who decides the roster — HR centrally, or department heads for their own people?
22. How far ahead is the roster published? *(default: assigned by date range, no fixed publication cycle)*
23. Do shift timings differ by season, or by department?
24. Grace period for a late arrival before it counts as "late"? *(default: 10 minutes)*
25. How early before shift start may someone punch in? *(default: 30 minutes)*
26. How late after shift end may someone punch out? *(default: 120 minutes)*
27. Minimum hours for a full day? For a half day? *(default: 8 hours full, 4 hours half)*
28. Is break time deducted automatically from worked hours, or do people punch out and in for breaks?
29. Do you want multiple punch pairs per day (out for lunch, back in), or strictly one IN and one OUT? *(default: one pair)*

## D. Weekly offs

30. What is the standard weekly off? *(default: Sunday)*
31. Alternate Saturdays off? Which ones — 2nd and 4th? *(default: none)*
32. Does the weekly off differ by department, location, or individual?
33. If someone works on their weekly off, what happens — comp-off, overtime, or nothing?

## E. Holidays

34. How many paid holidays per year?
35. Do all locations share one holiday list, or does each have its own?
36. Do you run **restricted / optional holidays** (a pool where each person picks N)? If yes, how many may each person take?
37. Share this year's holiday list if you have it, so the seed data is real.
38. If a holiday falls on a Sunday, is it moved or lost? *(default: lost, no substitution)*

## F. Punch policy **[BLOCKER — Phase 1]**

39. Punch from a **web browser on an office machine** — allowed, or mobile only? *(default: both allowed)*
40. If web punch is allowed, should it be restricted to office IP addresses? *(default: yes)*
41. Should there be a **shared kiosk** mode — one tablet at the gate where each person punches with a PIN or code? *(default: no)*
42. Punch **outside the allowed window**: block it outright, allow it with a mandatory typed reason and flag it, or allow it silently and flag it? *(default: allow with reason)*
43. When a flagged punch happens, who clears it — the reporting manager, or HR? *(default: manager, escalating to HR)*
44. Can an employee mark a **half day at the moment of punching**, or must it always be a leave application? *(default: yes, at punch)*
45. Should the punch screen show the person their status for today (late, on time, hours so far)? *(default: yes)*
46. Should someone be able to punch **before their shift is assigned** (no roster row)? *(default: falls back to their default shift)*

## G. Photo, location, device **[BLOCKER — Phase 1]**

47. Photo on **both** in and out, or in only? *(default: both)*
48. Selfie/front camera only — confirm no gallery upload is ever acceptable. *(default: front camera only, no gallery, no exceptions)*
49. Should the photo be shown to the employee after punching, or only to HR? *(default: shown to the employee)*
50. Photo retention period. *(default: 12 months, then automatic purge)*
51. Compression target per image — I've assumed 80–150 KB with a 256px thumbnail. Any reason to keep them larger? *(default: 80–150 KB)*
52. Do you want **GPS location** captured on punch? *(default: yes)*
53. Geofence around each office — block an out-of-radius punch, or record and flag it? *(default: flag, don't block)*
54. Geofence radius. *(default: 200 m)*
55. Should field staff be exempt from geofencing, and who marks someone as field staff? *(default: exempt, marked by HR)*
56. **Device binding** — should a person be locked to one phone? Off, warn on a new device, or require HR approval to switch? *(default: warn)*
57. Is there a real proxy-punching problem today, or is this precautionary? Your answer changes how aggressive the controls should be.

## H. Attendance rules and edge cases

58. Someone punches IN but never punches OUT. What should the day become — absent, half day, or pending until regularized? *(default: pending, flagged, notify both)*
59. Someone punches OUT but there is no IN. *(default: pending, flagged)*
60. Maximum credible hours in a day before the record is capped and flagged. *(default: 16 hours)*
61. Do you track **overtime**? If yes, from how many minutes past shift end does it start counting? *(default: tracked as minutes only, from 30 min past)*
62. Is overtime approved in advance, approved after the fact, or just recorded? *(default: just recorded)*
63. Does a **late arrival** carry a consequence (e.g. 3 lates = half day)? If yes, describe the rule exactly.
64. Does an **early exit** carry a consequence?
65. What counts as absent — and is there a rule where absence adjacent to a holiday/weekend consumes those days too (a "sandwich" rule)? *(default: no sandwich rule)*
66. Who can **manually override** a day's status — HR only, or managers too? *(default: HR only, with mandatory reason, marked in reports)*
67. Should the month be **locked** after payroll is run, so numbers can't shift afterwards? Who can unlock? *(default: HR locks, Admin unlocks, both audited)*
68. On what date of the month does attendance close for payroll? *(default: last day of the month)*
69. Is your attendance cycle the calendar month, or something like 26th to 25th?

## I. Regularization and on-duty

70. Can employees request a correction for a missed punch? *(default: yes)*
71. How many days back may they raise it? *(default: 7 days)*
72. How many per month before it's blocked? *(default: 3)*
73. Who approves — manager, HR, or both in sequence? *(default: manager)*
74. Do people work off-site often enough to need an **On Duty** request (client visit, site work, travel)? *(default: yes, built in Phase 2)*
75. Should on-duty require proof (photo, location, client name)? *(default: reason + optional site name)*

## J. Leave policy **[BLOCKER — Phase 2]**

76. List every leave type you offer, with its short code.
77. For each type: annual entitlement in days.
78. For each type: paid or unpaid.
79. For each type: does it accrue monthly, or is the full year credited upfront?
80. For each type: can it be taken as a half day?
81. For each type: carry-forward allowed? Capped at how many days?
82. For each type: minimum and maximum days per application, and notice days required.
83. For each type: does it need a document attached beyond N days (e.g. medical certificate after 3 days of sick leave)?
84. Leave year start month. *(default: April)*
85. What happens to unused leave at year end — lapse, carry forward, or encash? (Encashment would be recorded as a balance movement only; no money is calculated here.)
86. How is leave pro-rated for someone who joins mid-year? *(default: monthly pro-rata from joining month)*
87. Can leave balance go **negative**? If yes, up to how many days and for which types? *(default: no)*
88. Do you grant **comp-off** for working a holiday or weekly off? If yes, how long before it expires? *(default: yes, 90 days)*
89. Do holidays and weekly offs falling inside a leave period get consumed, or skipped? *(default: skipped, not consumed)*
90. Is there a maternity / paternity / bereavement leave with special handling?
91. Do you cap how many people from one department can be on leave at once? *(default: warn, don't block)*
92. Do you have an existing leave balance sheet that needs to be imported as opening balances at go-live?

## K. Approvals

93. Who approves leave — the reporting manager, or does everything go to one person? *(default: reporting manager)*
94. Does any leave type need **two-step** approval (manager then HR)? Which? *(default: none)*
95. Does length change the approver (e.g. over 5 days goes to a director)? *(default: no)*
96. If an approver doesn't act, should it auto-escalate? After how many days, and to whom? *(default: 3 days, to HR)*
97. Should approvers be able to **delegate** while on leave themselves? *(default: yes)*
98. Who approves the reporting manager's own leave? *(default: their manager; falls to HR if none)*
99. Should approvers be able to approve **in bulk** from one screen? *(default: yes, same type only)*
100. Can an approver **partially approve** (grant 2 of 3 days requested)? *(default: no — reject with a reason, employee reapplies)*

## L. Reports, export, payroll handoff **[BLOCKER — Phase 3]**

101. **Who runs payroll — a person in-house, your CA, or a payroll vendor?**
102. **What exact columns do they need each month?** If you can send me their current sheet or a screenshot, that beats any description — this becomes the versioned export contract.
103. In what format do they want it — Excel, CSV, or something importable into Tally?
104. Do they need one file per location, or one combined file?
105. Beyond the 13 reports already specified, is there a report you look at today that I've missed?
106. Do you want any report emailed on a schedule (e.g. daily absentee list at 10am to department heads)? *(default: available, off by default)*
107. Who is allowed to export data — HR and Admin only, or managers for their own team too? *(default: HR and Admin only)*
108. Should exports be watermarked or logged with who took them? *(default: logged and audited)*
109. Do you need a **printed muster roll** in a specific statutory format for inspections? If yes, share the format.

## M. Notifications

110. Which channels matter — in-app, email, WhatsApp? *(default: in-app and email now, WhatsApp architected for later)*
111. Do all employees have a work email address? If not, email-based invites won't work and we need a different provisioning route. **[BLOCKER — Phase 0]**
112. Should there be a **punch reminder** before shift start? *(default: available, opt-in)*
113. Should a manager get a daily digest of their team's absentees? *(default: yes, opt-in)*
114. Anything that should notify **you** personally regardless of role?

## N. Roles, permissions, admin

115. Admin has full CRUD on everything — confirmed. Should there be **more than one** Admin account? *(default: at least two, so you're never locked out)*
116. Should Admin be able to **impersonate** a user to debug an issue? It's useful and it's a real security risk; every action would be audited as "X acting as Y". *(default: no)*
117. Does "Operations" mean department heads specifically, or a broader supervisor group?
118. Should a manager see their team's **photos and GPS**, or only status and hours? *(default: status and hours; photos are HR/Admin)*
119. Should a manager see their team's **leave balances**? *(default: yes)*
120. Do you want a **read-only auditor** role for your CA or an external reviewer? *(default: no, but trivial to add later)*
121. Is there anyone who should see all data but change nothing?

## O. Interface and language

122. Confirm: shadcn components only, installed via the shadcn MCP, no exceptions. *(default: confirmed, already in CLAUDE.md)*
123. Light mode, dark mode, or both? *(default: both, light by default)*
124. Any brand colour, logo, or typeface to build the theme around? Send them if so.
125. Interface language — English only, or does the shop floor need Marathi/Hindi on the punch screen at least? *(default: English only)*
126. Confirm: TallyPrime keyboard parity, hint chips shown on every control that has a shortcut. Any Tally key you personally use constantly that must work on day one?
127. Date format. *(default: dd-MM-yyyy)*
128. Is the punch screen the only thing most employees will ever open? If so it should be the app's landing screen for them. *(default: yes for the Employee role)*

## P. Data, retention, security

129. How long must attendance records be retained? *(default: 7 years)*
130. Is any of this data going to be shown to a labour inspector or auditor?
131. Should employees be able to see their **own** punch photos and history indefinitely? *(default: yes, own records)*
132. Two-factor authentication — required for Admin, or for everyone? *(default: Admin only)*
133. Any policy on where data must be stored (India-only hosting, on-premise)? **[BLOCKER — Phase 0]**
134. Is there an existing system whose historical data needs migrating in? If yes, how far back and in what format?

## Q. Technology and hosting **[BLOCKER — Phase 0]**

135. NestJS or plain Fastify for the API? *(default: NestJS)*
136. Hosting: your own VPS with Docker, or a managed platform? *(default: VPS)*
137. Do you already have a VPS / cloud account, or does this need setting up?
138. Domain name for the app.
139. File storage: self-hosted MinIO, AWS S3, or Cloudflare R2? *(default: R2 in production, MinIO in dev)*
140. Email sending: your existing Google Workspace SMTP, or a service like Resend/SES? *(default: SMTP from your existing mail)*
141. Do you want a staging environment, or production only? *(default: staging, it pays for itself)*
142. Who else will have repository access?
143. Product name — **Setu** is proposed. Confirm, or give me the name you want.

## R. Rollout

144. Pilot with one department first, or switch everyone over at once? *(default: pilot one department for a month)*
145. Which department would you pilot with?
146. Target go-live date, if you have one.
147. Will attendance run in parallel with the current method for a period? *(default: yes, one month)*
148. Who trains the staff, and do you need a printed one-page guide in a local language?
149. What is the fallback if the system is down at shift start? *(default: offline queue handles it; register as a last resort)*

## S. Future modules

150. When you say ERP data comes from Tally — which entities specifically? Ledgers/parties, stock items, sales and purchase vouchers, outstanding balances, all of it?
151. Is Tally on a single office machine today, or already on a server?
152. Should attendance eventually push into Tally's payroll directly, or is a clean file handoff enough long-term?
153. For the CRM phase later — is that for the switchgear business, or a separate product to sell?
154. Anything you know is coming in 12 months that I should leave room for now?

---

## Anything I haven't asked

155. What does the current attendance process actually look like, start to finish? Describe a normal day and a normal month-end.
156. What goes wrong today that made you want to build this?
157. Is there a system you've used before — good or bad — that I should look at?
158. What would make you consider this product a failure six months after launch?

Question 156 and 158 are the two I'd most like answered. Everything else is detail; those two are direction.
