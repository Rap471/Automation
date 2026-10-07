# FYB functional QA report

**Test date:** 1 October 2026 (Asia/Shanghai)  
**Target:** https://dev-jira.fybtech.xyz/projects  
**Account:** rafael.pineda@patolomius.com — confirmed SuperAdmin in Account Management  
**Method:** Interactive browser testing through the Codex in-app browser, with DOM/accessibility observations and screenshots. Desktop layout only. No source-code, API, database, load, or security testing.

## Outcome

**Not ready for an “all functions correct” sign-off.** Core project and issue workflows passed, but two reproducible data-display defects were found. Four additional observations need follow-up. Several functions were inspected without submitting changes, and the browser stopped responding during the final sprint check.

Expected results below are based on control labels, ordinary application behavior, and consistency between the application's own views. No requirements specification or acceptance criteria were supplied. A page loading successfully is not evidence that all operations on that page work.

Project creation initially produced no visible result in two attempts. A later attempt with the same conventional key succeeded and was verified. **The earlier attempts are inconclusive, not a confirmed creation defect.** Some UI actions also required reinspection or direct navigation to an already observed link; these interaction anomalies were not counted as site defects.

## Reproduced defects

### D01 — Admin dashboard reports zero users despite populated account directory

**Severity:** Medium — misleading administrative metrics.  
**Routes:** `/admin`, `/admin/accounts`

1. Sign in with the supplied account.
2. Open Admin.
3. Observe Total Users = **0**, Active Users = **0**, and “No user data available.”
4. Open See users, then search for `rafael.pineda`.
5. Observe Account Management statistics: **253 total, 38 active, 215 inactive, 15 admins**, with a matching active SuperAdmin account.
6. Return to Admin. Zero user totals remain after fresh navigation.

**Expected:** Dashboard totals and recent-user content agree with the account directory, or display an explicit loading/error/unavailable state.  
**Actual:** Dashboard presents zero as a valid total while the directory contains users. Its Recent Activity also says “No audit logs available,” although the Audit Logs page contains the QA changes.

Evidence: [Admin dashboard](admin-zero-users.jpg), [Account directory](accounts-253-users.jpg).

### D02 — Gantt displays invented dates for an undated epic

**Severity:** Medium — misleading project schedule.  
**Routes:** `/projects/SPS/epics`, `/projects/SPS/gantt`

1. Create `QA Regression Epic 20261001` with a name and description only; leave start/end dates blank.
2. Open the created epic, key **SPS-0FEBD0**.
3. Its Timeline says **Start: Not set; End: Not set** and it has zero issues.
4. Open Gantt.
5. The same epic is labeled **Oct 1, 2025 → Oct 1, 2027** and is represented by a bar across that range.

**Expected:** An epic without dates or dated child issues appears as unscheduled, or any visualization fallback is clearly identified as an estimate and not shown as its actual dates.  
**Actual:** A concrete two-year schedule is displayed without an indication that dates are unset.

Evidence: [Gantt schedule](gantt-invented-epic-dates.jpg). The epic detail's “Not set” values were recorded through the DOM snapshot; no detail screenshot was saved before the browser interruption.

## Observations requiring follow-up

| ID | Observation | Expected result / follow-up | Evidence and confidence |
|---|---|---|---|
| O01 | Sample Scrum overview and Issues list disagree on counts. Before QA additions: overview 12 active / 1 archived; list 14 active / 3 archived. After parent and child creation: overview 13 active / 1 archived; list 16 active / 3 archived. | Define whether subtasks count. Use consistent labels or explicitly state that overview excludes them. Differences may be an intentional counting rule, so this is not classified as a confirmed defect. | [Overview](project-overview-counts.jpg); issue-list DOM observations. |
| O02 | Empty QA sprint's Velocity Report shows Average Completion Time **3.2 days** despite zero issues and “No completed sprints yet.” | Show unavailable/zero, or label a benchmark and explain its source. Validate the metric's intended scope. | Observed report text; final screenshot/reproduction was blocked by browser timeout. |
| O03 | Global search for existing `SPS-19`, including Enter, left Settings unchanged without visible results. | Existing issue should be discoverable, or the search interaction should be explained. Recheck with a standard browser before filing a defect. | [Search state](global-search-no-result.jpg). No search result appeared in successive observations. |
| O04 | Issue Export produced no visible menu, confirmation, or captured download on a filtered issue list. A second attempt with a download listener timed out after 10 seconds. | Export should produce a file or explicit feedback. Verify browser download support and repeat before attributing the failure to the site. | Browser test observation; download contents unverified. |

## Executed functional checks

**PASS** means the stated result was visibly verified. **INSPECTED** means the UI loaded; its mutation or business result was not tested. **INCONCLUSIVE** means the outcome could not be established.

| ID | Function / steps | Expected result | Actual result | Status |
|---|---|---|---|---|
| T01 | Open Projects while signed out | Redirect to login | `/login` shown | PASS |
| T02 | Empty login fields | Sign-in unavailable | Sign in disabled | PASS |
| T03 | Uncheck Remember me, enter supplied credentials | Submit becomes available | Checkbox unchecked; Sign in enabled | PASS |
| T04 | Sign in | Authenticated application opens | Dashboard loaded | PASS |
| T05 | Dashboard recent-activity Next | Different activity page and usable Prev | Page 2 of 4; entries changed; Prev enabled | PASS |
| T06 | Projects navigation | Project directory loads | Active project rows and controls loaded | PASS |
| T07 | Project search for nonexistent value | Clear empty state | “No projects found.” | PASS |
| T08 | Project search by name/key | Matching projects only | Sample Project Scrum and later QA project found | PASS |
| T09 | Project sorting control | Sort mode changes | Newest changed to Name; ordering correctness across the entire directory not asserted | PASS (mode only) |
| T10 | Empty Create Project submission | Required-field feedback or blocked submission | No creation, but no visible validation message and Name did not expose native required validation | INCONCLUSIVE validation |
| T11 | Create Scrum project QAFYB | Persisted project with correct details | Name, key, summary, Project Admin role, 0 issues visible | PASS |
| T12 | QA project favorite / unfavorite | Toggle persists and label changes | Unfavorite project appeared; original state restored | PASS |
| T13 | Archive QA project | Recoverable confirmation; removed from active list | Confirmation shown; QA project absent from active list, present in Archived | PASS |
| T14 | Restore QA project | Returns to active state | Removed from archived list; settings show Archived: No | PASS |
| T15 | Edit QA project name | Saved value persists | Name changed to “QA Functional Regression 20261001 - verified” | PASS |
| T16 | Open Sample Scrum overview | Overview and navigation load | Epics, issues, sprints, members, page links loaded | PASS (load); counts O01 |
| T17 | Issue search `SPS-18` | Single matching issue | One active result, correct key and summary | PASS |
| T18 | Clear issue filters | Full list restored | 14 active issues restored before QA additions | PASS |
| T19 | Empty issue creation form | Submit disabled without summary | Create disabled | PASS |
| T20 | Create Task with QA summary | New task persists | SPS-19 created with To Do, Medium, Unassigned; dates defaulted to Oct 1–3 | PASS; date defaults require product confirmation |
| T21 | Open QA issue summary | Correct issue detail | Issue-details dialog for SPS-19 | PASS |
| T22 | To Do → In Progress / Apply | Status persists with history | In Progress displayed; status and workflow events recorded | PASS |
| T23 | Edit summary and priority | Saved values persist | Edited summary and HIGH priority visible; persisted on reopen | PASS |
| T24 | Assign to me | Current account selected and persisted | rafael.pineda selected; assignment history recorded | PASS |
| T25 | Add issue comment | Saved comment, author, timestamp | QA comment appeared under rafael.pineda | PASS |
| T26 | Watch / Unwatch | Toggle and watcher history | Unwatch appeared; Watch restored; history present | PASS |
| T27 | Bug type filter | Only Bug results | One row, SPS-7, BUG | PASS |
| T28 | Scrum Board load | Active sprint issues in status columns | Two To Do issues in Sample Sprint, other columns empty | PASS |
| T29 | Switch to Swimlanes | Grouped board view | Unassigned group with two issues | PASS (view switch) |
| T30 | Backlog load | Sprint/backlog issue sections | Active/planned sections and QA issue visible | PASS (load) |
| T31 | Create QA sprint in Backlog | New planned sprint | QA Regression Sprint 20261001, planned, 0 issues | PASS |
| T32 | Sprints list/detail | Created sprint discoverable | QA sprint listed and detail opened | PASS |
| T33 | Burndown tab for empty sprint | Empty/zero chart values | Seven days at 0 SP, remaining 0, progress 0% | PASS (empty state only) |
| T34 | Velocity tab | Report appears | Type totals 0/0; no completed sprints; questionable 3.2-day metric | PASS (load); O02 |
| T35 | Create QA epic | Persisted epic with entered description | SPS-0FEBD0 created and opened | PASS |
| T36 | Epic Add Issue / Cancel | Form opens and cancellation leaves epic unchanged | Form opened; cancelled; zero issues at that time | PASS (open/cancel) |
| T37 | Gantt load | Timeline and scheduled issues | Existing and QA issues loaded with dates | PASS (load); D02 |
| T38 | Calendar Next / Prev | October → November → October | Correct headings; November empty state; QA parent/child visible in October | PASS |
| T39 | Project settings tabs | Each configuration section loads | Details, Story Points, Dependencies, Workflow, Enabled Pages, Groups, Members inspected | INSPECTED |
| T40 | Global Activity filter Oct 1–Oct 1 / Refresh | Only selected date's events | QA events for Oct 1 returned | PASS |
| T41 | Notification Open | Correct linked issue opens | Mention opened FTFYB-3 with matching comment | PASS |
| T42 | Admin Account search | Matching account and statistics | Active SuperAdmin account returned; 253 user total | PASS |
| T43 | Admin analytics | Metrics and project table load | Type/priority totals and project pagination displayed | INSPECTED; numerical accuracy not fully validated |
| T44 | Admin system page | Diagnostic status available or explicit unavailable state | Services and resources report Unknown; maintenance/configuration controls visible | INSPECTED |
| T45 | Audit Logs | QA changes traceable | Issue creation/transition/edit/comment/watch and sprint creation records present | PASS (presence only) |
| T46 | Slack load | Workspace/channel content and composer | 29Black/general messages visible; Send disabled when empty | PASS (load/empty composer) |
| T47 | Slack search `paging-smoke` | Matching message results | 50 matching results displayed | PASS |
| T48 | Wiki choose Tististeng / open observed page URL | Selected space and page content load | Page content, version history, attachments/comments sections loaded | PASS (read only); sidebar selected option mismatched header after direct navigation |
| T49 | Wiki favorite toggle | Toggle reversible | Starred link appeared, then removed; original state restored | PASS |
| T50 | Settings Profile / Preferences / Account | Tabs load with account's available options | Profile read-only; preference controls visible; account deletion disabled | INSPECTED |
| T51 | Create subtask on QA issue | Child persists under parent | SPS-20 created; parent shows 0 of 1 done and creation history | PASS |
| T52 | Associate QA issue with QA epic | Association persists | Selected QA Regression Epic 20261001 and updated issue metadata | PASS (selected value); inverse epic count not rechecked |
| T53 | Global issue search | Existing issue discoverable | No visible outcome | INCONCLUSIVE — O03 |
| T54 | Filtered issue export | Download/file with filtered data | No captured download | INCONCLUSIVE — O04 |

## Test data left for review

No existing project was archived or edited. QA objects were retained for reproduction; no permanent deletion was performed.

- **Project QAFYB:** QA Functional Regression 20261001 - verified; restored, active, unfavorited, Scrum, 0 issues.
- **Issue SPS-19:** QA Regression 20261001 - edited lifecycle; In Progress; HIGH; assigned to rafael.pineda; one QA comment; not watched; associated with QA Regression Epic 20261001.
- **Subtask SPS-20:** QA Regression 20261001 - child task; To Do; under SPS-19.
- **Epic SPS-0FEBD0:** QA Regression Epic 20261001; in SPS; created without dates.
- **Sprint:** QA Regression Sprint 20261001; in SPS; planned; empty. Observed route: `/projects/SPS/sprints/qa-regression-sprint-20261001`.

The supplied password is deliberately omitted from this report and all report files.

## Remaining coverage and limitations

- Authentication negative cases, lockout, forgot-password submission, password change, logout/session expiration, and Remember me persistence remain untested. The session could not be logged out after the browser became unresponsive.
- Kanban-specific creation/board behavior, drag/drop reorder, sprint assignment, sprint start/complete, estimates, capacity, blocked completion rules, and complete workflow-transition combinations remain untested.
- Attachments/uploads/download integrity, issue links, comment editing/deletion, issue archive/restore, permanent deletion, and all export formats remain unverified.
- Settings mutations beyond QA project name, enabled-page persistence, notification delivery/preferences, member/role changes, user creation/edit/deletion, and administrative maintenance remain untested.
- Chat sending, DM/group creation, reactions, thread replies, channel changes, and external notifications were not submitted. Wiki page creation/edit/publish/restore, uploads, and comments were not submitted.
- Multiple user roles, permission isolation, mobile/responsive layouts, cross-browser behavior, accessibility conformance, timezone correctness, concurrent updates, and performance/security were not tested.
- Browser automation timed out on final navigation to the QA sprint. Earlier successful observations and saved screenshots remain valid; the final state is unverified.

## Recommended next steps

1. Fix or explain D01 and D02, then retest the two views in each defect.
2. Confirm counting rules, completion metric scope, default issue dates, and search/export interactions; reproduce O01–O04 in a standard browser.
3. Finish remaining workflows using approved disposable data and separate role accounts. Require end-to-end persistence and export-content checks before release sign-off.

## Evidence files

- [Project created](project-created.jpg)
- [Issue lifecycle](issue-lifecycle.jpg)
- [Admin dashboard](admin-zero-users.jpg)
- [Account statistics](accounts-253-users.jpg)
- [Gantt dates](gantt-invented-epic-dates.jpg)
- [Project overview](project-overview-counts.jpg)
- [Global search](global-search-no-result.jpg)
