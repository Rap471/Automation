# FYB QA report - all three roles


## Test context and role perspectives

Target: https://dev-jira.fybtech.xyz. Date: 1 October 2026, Asia/Shanghai. Method: interactive Codex in-app browser, DOM/accessibility observations and screenshots. Desktop only. No source, API, database, load or security penetration testing. Passwords are omitted.

Expected results are inferred from control labels, ordinary application behavior, role hierarchy and consistency between application views. No formal permission specification or acceptance criteria was supplied. An unexpected capability is reported as an observation unless the intended rule is established.


### Accounts verified

**SuperAdmin:** rafael.pineda@patolomius.com | rafael.pineda | global SuperAdmin / Active

**Admin:** mocekij762@pumpoly.com | moce | global Admin / Active; QARA Project Admin

**Member:** sabaye4398@pumpoly.com | sabye | global User / Active; QARA Member after fixture setup

Global account role and project role are separate. Admin and Member initially had no projects in the directory. Admin created QARA and automatically became its Project Admin. The supplied Member was added only to this QA project, containing ordinary test data, to allow a fair comparison of project workflows. No global roles were changed.


### SuperAdmin point of view

**Scope:** Dashboard showed 80 active projects and global recent activity. QARA settings accessible without project membership.

**Working:** Original 54-check run covered project create/edit/archive/restore, issue/comment/subtask/epic/sprint workflows and navigation. Current run verified cross-role edit and full create-user role options.

**Problems:** Administration user metrics remain zero despite populated directory. Gantt defect reproduced previously and under Admin/Member.


### Admin point of view

**Scope:** Admin navigation, full account directory, global audit and analytics visible. Project dashboard initially empty until QARA creation.

**Working:** Created project, added Member, created/edited/transitioned/self-assigned issue, created sprint and epic. Actor audit filter returned 21 matching records.

**Restrictions:** Self-delete disabled; new-user form excludes SuperAdmin; existing SuperAdmin role dropdown disabled. Other privileged-account changes not submitted.


### Member point of view

**Before:** No projects; zero dashboard metrics; Admin route denied; unrelated project settings redirected. Wiki spaces and one assignment notification visible.

**After:** QARA visible with role Member. Issue create/edit/transition/self-assignment/watch/subtask passed; project chat became available.

**Restrictions:** Project settings hidden/direct route redirected. Sprint creation and management hidden. Project archive denied. Epic creation succeeds; intended policy needs confirmation.

Status meanings: PASS verifies only the stated behavior. Form/load-only passes do not verify submission. FAIL identifies the stated defect, which may be feedback rather than a backend authorization failure. OBSERVATION needs product-policy clarification. BLOCKED identifies an unestablished outcome.

Current 37 checks: 29 pass, 5 fail, 2 observation, 1 blocked. Counts are checks, not distinct defects. Several checks reproduce the same defect. The earlier 54 checks are separately identified and must not be treated as 91 independent full end-to-end workflows.


## Observed capability comparison

Function | SuperAdmin | Admin | Member

Project scope | Global projects | Assigned/created | Assigned only

Administration | Available | Available | Direct /admin denied

New-user roles | User/Admin/SuperAdmin* | User/Admin* | Admin unavailable

Create project | Succeeded (QAFYB) | Succeeded (QARA) | Denied; wrong message

Project settings | Global access | Own Project Admin | Hidden; direct redirect

Add project Member | Inspected previously | Succeeded in QARA | Settings unavailable

Create/edit issue | Succeeded | Succeeded | Succeeded in QARA

Status/self-assign | Succeeded | Succeeded | Succeeded

Subtask/watch | Succeeded | Not repeated fully | Succeeded

Create epic | Succeeded | Succeeded | Succeeded; policy open

Create sprint | Succeeded | Succeeded | Hidden

Start/complete sprint | Not executed | Not executed | Management hidden

Archive/restore project | Succeeded (QAFYB) | Not repeated | Denied; enabled control

Board/calendar/backlog | Loaded | Loaded | Loaded

Gantt undated epic | Incorrect date fallback | Same defect | Same display

User metrics | Wrong zero totals | Wrong zero totals | Admin unavailable

Chat/wiki | Read/search only | Wiki read only | Chat/wiki read only

* New-user form inspected only. No user accounts were created or elevated. Backend denial is established only for actions actually submitted; hidden controls alone do not prove server authorization.


## Confirmed defects


### D01 - Administration user metrics are incorrect

**Severity:** Medium | Admin and SuperAdmin

**Reproduce:** Open /admin, compare /admin/accounts and /admin/audit-logs.

**Expected:** Dashboard should show consistent system data or explicit unavailable/error state.

**Actual:** Dashboard Total Users 0, Active Users 0, no recent users/audits. Directory 253 total, 38 active, 215 inactive, 15 admins. Admin audit page had 4558 records before new fixtures; actor filter returned 21.

**Checks:** A04, S06; prior D01


### D02 - Gantt invents dates for an undated epic

**Severity:** Medium | SuperAdmin, Admin; visible to Member

**Reproduce:** Create epic without start/end dates; open Gantt.

**Expected:** Show unscheduled or clearly label visualization fallback, rather than actual dates.

**Actual:** QA Role Epic 20261001, created with blank dates, displayed Oct 1, 2025 to Oct 1, 2027. Earlier SPS epic detail said Not set.

**Checks:** A12, M13; prior D02


### D03 - Member project denial uses attachment error

**Severity:** Medium | Member

**Reproduce:** With no project memberships, Add Project; name QA Role Member 20261001, key QARM, Kanban; submit Create.

**Expected:** Relevant project-creation denial; controls should reflect permission.

**Actual:** No project created. Message: You do not have permission to attach files to this issue. No attachment operation was performed.

**Checks:** M02


### D04 - Member has enabled project archive control

**Severity:** Low | Member

**Reproduce:** On QARA project list, click Archive project; confirm QA-only archive.

**Expected:** Hide/disable forbidden archive or explain permission before confirmation.

**Actual:** Confirmation is offered; submission returns Insufficient project role; QARA remains active. Backend restriction works; defect is misleading UI.

**Checks:** M15


## Observations requiring follow-up


### O05 - Member can create epics

**Actual:** Member successfully created QARA-4AD804 while Create Sprint is hidden. No requirements specify whether this difference is intended.

**Follow-up:** Confirm permission matrix for epic create/edit/delete and sprint management. Do not label a privilege escalation without policy/backend validation.


### O06 - Admin privileged-account controls

**Actual:** Existing SuperAdmin row exposes Edit/Assign/Delete. Edit disables Role but leaves Name, Email and Active controls editable. No changes submitted.

**Follow-up:** Validate intended rules using disposable accounts and an approved security test. Visible controls do not establish backend authorization.


### O07 - Administrative scope and availability

**Actual:** Admin analytics shows global issue counts, while project overview is membership-scoped. System service/resource statuses show Unknown. Wiki lists shared spaces even when user has no projects.

**Follow-up:** Document intended scope and availability states. No claim of unauthorized data exposure is established.


### O01-O04 - Earlier unresolved observations

**Counts:** Overview appears to exclude subtasks; current QARA directory says 2 issues while issue list/calendar includes 3. Clarify labels/counting rules.

**Velocity:** Earlier empty sprint showed Average Completion Time 3.2 days. Current Admin sprint detail follow-up blocked by browser stall.

**Search/export:** Earlier global search produced no visible result; issue export captured no download. Current local issue-key search passed. Export content remains unverified.


## SuperAdmin checks - current run


### S01 - Login/global scope | PASS

**Expected:** SuperAdmin should see global projects and administer QA fixture

**Actual:** Dashboard 80 active projects; QARA settings accessible despite not being its project member.


### S02 - Issue key search | PASS

**Expected:** Key search should restrict results

**Actual:** QARA-2 search returns just the Member parent issue.


### S03 - Cross-project issue edit | PASS

**Expected:** SuperAdmin can edit QA issue created by Admin

**Actual:** QARA-1 summary updated with SuperAdmin verified suffix.


### S04 - User role verification/create-user form | PASS

**Expected:** SuperAdmin role choices should exceed Admin choices

**Actual:** Member account is global User/Active, display sabye. SuperAdmin new-user form offers User/Admin/SuperAdmin versus Admin User/Admin only; not submitted.


### S05 - Project configuration tabs | PASS

**Expected:** All configuration tabs should render

**Actual:** Story Points, Dependencies, Workflow, Enabled Pages and Project Groups open; no configurations submitted.


### S06 - Admin dashboard metrics | FAIL

**Expected:** Global user totals should match directory

**Actual:** SuperAdmin dashboard repeats zero users/active users and no recent user/audit data, while directory shows 253/38.


## Admin checks - current run


### A01 - Login / navigation | PASS

**Expected:** Authenticate with Admin UI

**Actual:** moce signed in; Admin present; no assigned projects; dashboard zero


### A02 - Account directory / own account | PASS

**Expected:** Directory usable and self-delete blocked

**Actual:** 253 users / 38 active; moce role Admin; detail read-only; own Delete disabled


### A03 - Create-user form | PASS - form only

**Expected:** Limit assignable roles and block empty submit

**Actual:** User/Admin options only; no SuperAdmin; empty Create disabled; not submitted


### A04 - Administration dashboard and analytics | FAIL

**Expected:** System totals should agree with the user directory and audit data

**Actual:** Dashboard shows 0 users and no audits; directory has 253 users and audit logs 4558 records. Analytics global issue counts remain populated.


### A05 - Audit log filter | PASS

**Expected:** Actor filter should restrict visible records

**Actual:** Actor filter shows 21 records, all attributed to mocekij762@pumpoly.com.


### A06 - Create Scrum project | PASS

**Expected:** Admin may create a project and receive Project Admin membership

**Actual:** QARA created successfully; list shows Project Admin and 0 issues.


### A07 - Add project Member | PASS

**Expected:** Project Admin may add supplied test user as Member to QA-only project

**Actual:** sabye added to QARA as Member; existing Admin remains Project Admin.


### A08 - Create/edit/transition/assign issue | PASS

**Expected:** Changes should persist and history identify actor

**Actual:** QARA-1 created; summary updated, High priority, In Progress and assigned moce. History records transitions and assignment.


### A09 - Create sprint | PASS

**Expected:** Sprint should persist as planned

**Actual:** QA Role Sprint 20261001 saved as planned, 0 issues, capacity 0.


### A10 - Create epic | PASS

**Expected:** Undated epic should persist as Planned

**Actual:** QA Role Epic 20261001 appears Planned with 0 linked issues.


### A11 - Board/calendar/backlog | PASS

**Expected:** Views should respect sprint and issue dates

**Actual:** Board empty for selected empty sprint; backlog shows QARA-1; calendar start Oct1/due Oct3.


### A12 - Gantt undated epic | FAIL

**Expected:** Missing dates should remain unset

**Actual:** Undated QA epic plotted Oct1 2025â€“Oct1 2027.


### A13 - SuperAdmin account edit protection | OBSERVATION

**Expected:** Admin should not change SuperAdmin role

**Actual:** Role dropdown disabled; Name/Email/Active editable UI; no account changes submitted. Delete/Assign controls enabled, backend restrictions unverified.


### A14 - Activity/inbox/wiki/profile | PASS

**Expected:** Ancillary views should load under Admin

**Actual:** Activity shows QARA actions including Member events; inbox clear; wiki spaces listed; profile moce and supplied email displayed. No messages or profile edits submitted.


### A15 - Sprint detail/report follow-up | BLOCKED

**Expected:** Sprint detail should remain responsive

**Actual:** Browser tab stalled when revisiting sprint detail as Admin; clean-tab recovery succeeded. Cannot attribute to app or browser; report/export tests incomplete.


## Member checks - current run


### M01 - Login / empty dashboard | PASS

**Expected:** Authenticate and show only scoped data

**Actual:** Signed in as sabaye4398; all dashboard totals zero; Admin absent


### M02 - Project creation permission | FAIL - error feedback

**Expected:** Allow permitted creation or show relevant denial

**Actual:** Add Project form visible, but Create denied with unrelated file-attachment permission message


### M03 - Direct Admin route | PASS

**Expected:** Deny non-admin access

**Actual:** Access denied page shown


### M04 - Unrelated project settings | PASS

**Expected:** Deny non-member access

**Actual:** QAFYB settings redirected to Dashboard


### M05 - Activity / notifications / chat | PASS - load only

**Expected:** Load scoped pages and explain empty states

**Actual:** No activity; one assignment notification; chat no-project state; send disabled


### M06 - Wiki / profile / logout | PASS - load/logout

**Expected:** Load UI and end session

**Actual:** Wiki spaces visible; profile read-only; Logout returned to login


### M07 - Assigned project/dashboard | PASS

**Expected:** Membership should make QA project and its issue metrics visible

**Actual:** Dashboard now shows 1 active project, 1 In Progress, 1 High Priority. Project role Member.


### M08 - Project settings authorization | PASS

**Expected:** Member should not manage project configuration

**Actual:** Settings link hidden; direct QARA/settings redirects to dashboard.


### M09 - Issue lifecycle/watch | PASS

**Expected:** Member may create and update issues in assigned project

**Actual:** QARA-2 created, edited, In Progress, assigned sabye. Watch/unwatch history persisted.


### M10 - Create subtask | PASS

**Expected:** Subtask should be linked to parent

**Actual:** QARA-3 QA Member subtask appears in QARA-2 details.


### M11 - Sprint administration controls | PASS

**Expected:** Member should view sprint without creation/management controls

**Actual:** Create Sprint hidden; sprint detail shows read-only dates/state/issues and no start/complete controls.


### M12 - Epic access | OBSERVATION

**Expected:** Member epic permissions should match the product role policy.

**Actual:** Member successfully created QA Member Epic 20261001 (QARA-4AD804), Planned. This is broader than sprint permissions; intended epic policy was not provided.


### M13 - Board/calendar/backlog/Gantt | PASS

**Expected:** Read views should match scoped QA records

**Actual:** Empty selected sprint board; 2 parent backlog issues; calendar includes 3 issues/subtask; Gantt renders all 3 plus undated epic fallback. Backlog start/create sprint hidden.


### M14 - Project chat | PASS

**Expected:** Member should access project channel after membership

**Actual:** QARA general channel visible, 2 members and empty composer; no messages sent.


### M15 - Project archive enforcement | FAIL

**Expected:** Member should not archive project and controls should reflect permission

**Actual:** Archive control and confirmation visible, submission denied with Insufficient project role. QARA remains active. Backend permission passes; misleading enabled control fails usability.


### M16 - Logout | PASS

**Expected:** Logout should end session

**Actual:** Login screen displayed after logout.


## SuperAdmin checks - earlier 54-check run

These checks were performed earlier on 1 October 2026 using the same SuperAdmin account. They are preserved here in full. They are historical results from that run, not a claim that each operation was repeated for Admin and Member.


### T01 - Open Projects while signed out | PASS

**Expected:** Redirect to login

**Actual:** `/login` shown


### T02 - Empty login fields | PASS

**Expected:** Sign-in unavailable

**Actual:** Sign in disabled


### T03 - Uncheck Remember me, enter supplied credentials | PASS

**Expected:** Submit becomes available

**Actual:** Checkbox unchecked; Sign in enabled


### T04 - Sign in | PASS

**Expected:** Authenticated application opens

**Actual:** Dashboard loaded


### T05 - Dashboard recent-activity Next | PASS

**Expected:** Different activity page and usable Prev

**Actual:** Page 2 of 4; entries changed; Prev enabled


### T06 - Projects navigation | PASS

**Expected:** Project directory loads

**Actual:** Active project rows and controls loaded


### T07 - Project search for nonexistent value | PASS

**Expected:** Clear empty state

**Actual:** “No projects found.”


### T08 - Project search by name/key | PASS

**Expected:** Matching projects only

**Actual:** Sample Project Scrum and later QA project found


### T09 - Project sorting control | PASS (mode only)

**Expected:** Sort mode changes

**Actual:** Newest changed to Name; ordering correctness across the entire directory not asserted


### T10 - Empty Create Project submission | INCONCLUSIVE validation

**Expected:** Required-field feedback or blocked submission

**Actual:** No creation, but no visible validation message and Name did not expose native required validation


### T11 - Create Scrum project QAFYB | PASS

**Expected:** Persisted project with correct details

**Actual:** Name, key, summary, Project Admin role, 0 issues visible


### T12 - QA project favorite / unfavorite | PASS

**Expected:** Toggle persists and label changes

**Actual:** Unfavorite project appeared; original state restored


### T13 - Archive QA project | PASS

**Expected:** Recoverable confirmation; removed from active list

**Actual:** Confirmation shown; QA project absent from active list, present in Archived


### T14 - Restore QA project | PASS

**Expected:** Returns to active state

**Actual:** Removed from archived list; settings show Archived: No


### T15 - Edit QA project name | PASS

**Expected:** Saved value persists

**Actual:** Name changed to “QA Functional Regression 20261001 - verified”


### T16 - Open Sample Scrum overview | PASS (load); counts O01

**Expected:** Overview and navigation load

**Actual:** Epics, issues, sprints, members, page links loaded


### T17 - Issue search `SPS-18` | PASS

**Expected:** Single matching issue

**Actual:** One active result, correct key and summary


### T18 - Clear issue filters | PASS

**Expected:** Full list restored

**Actual:** 14 active issues restored before QA additions


### T19 - Empty issue creation form | PASS

**Expected:** Submit disabled without summary

**Actual:** Create disabled


### T20 - Create Task with QA summary | PASS; date defaults require product confirmation

**Expected:** New task persists

**Actual:** SPS-19 created with To Do, Medium, Unassigned; dates defaulted to Oct 1-3


### T21 - Open QA issue summary | PASS

**Expected:** Correct issue detail

**Actual:** Issue-details dialog for SPS-19


### T22 - To Do  to  In Progress / Apply | PASS

**Expected:** Status persists with history

**Actual:** In Progress displayed; status and workflow events recorded


### T23 - Edit summary and priority | PASS

**Expected:** Saved values persist

**Actual:** Edited summary and HIGH priority visible; persisted on reopen


### T24 - Assign to me | PASS

**Expected:** Current account selected and persisted

**Actual:** rafael.pineda selected; assignment history recorded


### T25 - Add issue comment | PASS

**Expected:** Saved comment, author, timestamp

**Actual:** QA comment appeared under rafael.pineda


### T26 - Watch / Unwatch | PASS

**Expected:** Toggle and watcher history

**Actual:** Unwatch appeared; Watch restored; history present


### T27 - Bug type filter | PASS

**Expected:** Only Bug results

**Actual:** One row, SPS-7, BUG


### T28 - Scrum Board load | PASS

**Expected:** Active sprint issues in status columns

**Actual:** Two To Do issues in Sample Sprint, other columns empty


### T29 - Switch to Swimlanes | PASS (view switch)

**Expected:** Grouped board view

**Actual:** Unassigned group with two issues


### T30 - Backlog load | PASS (load)

**Expected:** Sprint/backlog issue sections

**Actual:** Active/planned sections and QA issue visible


### T31 - Create QA sprint in Backlog | PASS

**Expected:** New planned sprint

**Actual:** QA Regression Sprint 20261001, planned, 0 issues


### T32 - Sprints list/detail | PASS

**Expected:** Created sprint discoverable

**Actual:** QA sprint listed and detail opened


### T33 - Burndown tab for empty sprint | PASS (empty state only)

**Expected:** Empty/zero chart values

**Actual:** Seven days at 0 SP, remaining 0, progress 0%


### T34 - Velocity tab | PASS (load); O02

**Expected:** Report appears

**Actual:** Type totals 0/0; no completed sprints; questionable 3.2-day metric


### T35 - Create QA epic | PASS

**Expected:** Persisted epic with entered description

**Actual:** SPS-0FEBD0 created and opened


### T36 - Epic Add Issue / Cancel | PASS (open/cancel)

**Expected:** Form opens and cancellation leaves epic unchanged

**Actual:** Form opened; cancelled; zero issues at that time


### T37 - Gantt load | PASS (load); D02

**Expected:** Timeline and scheduled issues

**Actual:** Existing and QA issues loaded with dates


### T38 - Calendar Next / Prev | PASS

**Expected:** October  to  November  to  October

**Actual:** Correct headings; November empty state; QA parent/child visible in October


### T39 - Project settings tabs | INSPECTED

**Expected:** Each configuration section loads

**Actual:** Details, Story Points, Dependencies, Workflow, Enabled Pages, Groups, Members inspected


### T40 - Global Activity filter Oct 1-Oct 1 / Refresh | PASS

**Expected:** Only selected date's events

**Actual:** QA events for Oct 1 returned


### T41 - Notification Open | PASS

**Expected:** Correct linked issue opens

**Actual:** Mention opened FTFYB-3 with matching comment


### T42 - Admin Account search | PASS

**Expected:** Matching account and statistics

**Actual:** Active SuperAdmin account returned; 253 user total


### T43 - Admin analytics | INSPECTED; numerical accuracy not fully validated

**Expected:** Metrics and project table load

**Actual:** Type/priority totals and project pagination displayed


### T44 - Admin system page | INSPECTED

**Expected:** Diagnostic status available or explicit unavailable state

**Actual:** Services and resources report Unknown; maintenance/configuration controls visible


### T45 - Audit Logs | PASS (presence only)

**Expected:** QA changes traceable

**Actual:** Issue creation/transition/edit/comment/watch and sprint creation records present


### T46 - Slack load | PASS (load/empty composer)

**Expected:** Workspace/channel content and composer

**Actual:** 29Black/general messages visible; Send disabled when empty


### T47 - Slack search `paging-smoke` | PASS

**Expected:** Matching message results

**Actual:** 50 matching results displayed


### T48 - Wiki choose Tististeng / open observed page URL | PASS (read only); sidebar selected option mismatched header after direct navigation

**Expected:** Selected space and page content load

**Actual:** Page content, version history, attachments/comments sections loaded


### T49 - Wiki favorite toggle | PASS

**Expected:** Toggle reversible

**Actual:** Starred link appeared, then removed; original state restored


### T50 - Settings Profile / Preferences / Account | INSPECTED

**Expected:** Tabs load with account's available options

**Actual:** Profile read-only; preference controls visible; account deletion disabled


### T51 - Create subtask on QA issue | PASS

**Expected:** Child persists under parent

**Actual:** SPS-20 created; parent shows 0 of 1 done and creation history


### T52 - Associate QA issue with QA epic | PASS (selected value); inverse epic count not rechecked

**Expected:** Association persists

**Actual:** Selected QA Regression Epic 20261001 and updated issue metadata


### T53 - Global issue search | INCONCLUSIVE - O03

**Expected:** Existing issue discoverable

**Actual:** No visible outcome


### T54 - Filtered issue export | INCONCLUSIVE - O04

**Expected:** Download/file with filtered data

**Actual:** No captured download


## Retained test fixtures

QA objects are retained for reproducibility. No permanent deletion or account change was performed. The Member session was logged out on the recovered tab. A prior browser tab stalled during Admin sprint-detail navigation; that tab/session could not be inspected to confirm logout.


### Current role fixture: QARA

**Project:** QA Role Admin 20261001 | Scrum | active | moce Project Admin; sabye Member. No real project data added or exposed.

**Issues:** QARA-1: QA Admin role lifecycle 20261001 - SuperAdmin verified; In Progress, High, assigned moce. QARA-2: QA Member role lifecycle 20261001 - verified; In Progress, Medium, assigned sabye, unwatched. QARA-3: QA Member subtask 20261001; To Do, under QARA-2.

**Epics:** QARA-26778F: QA Role Epic 20261001; Planned, blank dates. QARA-4AD804: QA Member Epic 20261001; Planned, blank dates.

**Sprint:** QA Role Sprint 20261001; planned, empty, capacity 0.

**Denied:** QARM was not created. Member archive failed, QARA remains active.


### Earlier fixtures retained

**Project:** QAFYB: QA Functional Regression 20261001 - verified; active/restored, unfavorited, Scrum, no issues.

**Issues:** SPS-19: QA Regression 20261001 - edited lifecycle; In Progress, High, assigned rafael.pineda, one QA comment, unwatched, associated QA epic. SPS-20: To Do subtask.

**Planning:** SPS-0FEBD0: QA Regression Epic 20261001; originally undated. QA Regression Sprint 20261001: planned, empty.


## Coverage gaps and next steps

This is a functional and role comparison test report, not an all-functions-correct sign-off. User journeys were tested where stated; page loads and form inspection were not substituted for mutation verification.

- Account creation/edit/deactivation/deletion, global role changes, passwords, forgot-password email, lockout/session expiration and Remember me persistence were not submitted or fully validated. Permanent deletion requires a separate approved test.

- Sprint assignment/start/complete, estimates/capacity and complete transition combinations remain unverified. Admin sprint report follow-up was blocked by a browser timeout; clean-tab recovery worked. This is not filed as an app defect.

- Attachments/uploads/download integrity, issue links, comment editing/deletion, issue archive/restore and export contents remain unverified. Kanban-specific workflows, drag/drop and concurrent updates remain untested.

- Project workflow/dependency/story-point/enabled-page/group setting saves were inspected but not submitted. No global roles changed. Existing privileged-account backend protections were not probed.

- Chat sending, direct messages/groups, channel changes and notification delivery were not executed. Wiki create/edit/publish/restore/comments/uploads were not executed. Read access alone does not prove all write functions.

- Cross-browser/mobile/responsive layouts, accessibility conformance, timezone edge cases, performance, API authorization and security penetration testing remain outside this run.

Recommended order: fix D01-D04; confirm epic and privileged-account policies; retest unresolved search/export/velocity/count observations in a standard browser; complete remaining workflows with approved disposable fixtures; require persistence and exported-file validation before release sign-off.


## Evidence E01 - Member project creation - D03

Wrong attachment permission message after project submission. Screenshots reflect their capture time; later fixtures/edits may differ.

![Member project creation - D03](C:\Users\User 4\automation regressions\role-qa-20261001\member-create-denied-wrong-message.jpg)


## Evidence E02 - Member direct Admin denial

Access denied verifies navigation restriction. Screenshots reflect their capture time; later fixtures/edits may differ.

![Member direct Admin denial](C:\Users\User 4\automation regressions\role-qa-20261001\member-admin-denied.jpg)


## Evidence E03 - Admin account and directory

moce verified as Admin; populated statistics. Screenshots reflect their capture time; later fixtures/edits may differ.

![Admin account and directory](C:\Users\User 4\automation regressions\role-qa-20261001\admin-account-role.jpg)


## Evidence E04 - Admin project creation

QARA persisted with Project Admin role. Screenshots reflect their capture time; later fixtures/edits may differ.

![Admin project creation](C:\Users\User 4\automation regressions\role-qa-20261001\admin-project-created.jpg)


## Evidence E05 - QA-only membership

moce Project Admin and sabye Member in the fixture. Screenshots reflect their capture time; later fixtures/edits may differ.

![QA-only membership](C:\Users\User 4\automation regressions\role-qa-20261001\admin-member-fixture.jpg)


## Evidence E06 - Gantt dates - D02

Blank-date epic shown with concrete two-year range. Screenshots reflect their capture time; later fixtures/edits may differ.

![Gantt dates - D02](C:\Users\User 4\automation regressions\role-qa-20261001\admin-gantt-fabricated-dates.jpg)


## Evidence E07 - Member issue and subtask

QARA-2 persisted; child and history visible. Screenshots reflect their capture time; later fixtures/edits may differ.

![Member issue and subtask](C:\Users\User 4\automation regressions\role-qa-20261001\member-issue-lifecycle.jpg)


## Evidence E08 - Member epic capability - O05

Member-created epic visible alongside Admin epic. Screenshots reflect their capture time; later fixtures/edits may differ.

![Member epic capability - O05](C:\Users\User 4\automation regressions\role-qa-20261001\member-epic-created.jpg)


## Evidence E09 - Member archive denial - D04

Insufficient project role; project remains active. Screenshots reflect their capture time; later fixtures/edits may differ.

![Member archive denial - D04](C:\Users\User 4\automation regressions\role-qa-20261001\member-archive-result.jpg)


## Evidence E10 - SuperAdmin cross-role editing

SuperAdmin updated Admin-created issue. Screenshots reflect their capture time; later fixtures/edits may differ.

![SuperAdmin cross-role editing](C:\Users\User 4\automation regressions\role-qa-20261001\superadmin-cross-role-edit.jpg)


## Evidence E11 - SuperAdmin dashboard - D01

Zero user counts and absent recent audit data. Screenshots reflect their capture time; later fixtures/edits may differ.

![SuperAdmin dashboard - D01](C:\Users\User 4\automation regressions\role-qa-20261001\superadmin-dashboard-metrics.jpg)


## Evidence E12 - Privileged account form - O06

Admin sees SuperAdmin edit form; Role disabled, other changes unsubmitted. Screenshots reflect their capture time; later fixtures/edits may differ.

![Privileged account form - O06](C:\Users\User 4\automation regressions\role-qa-20261001\admin-superadmin-edit-role-disabled.jpg)


## Evidence E13 - Earlier SuperAdmin lifecycle

SPS-19 and QA subtask/comment work. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier SuperAdmin lifecycle](C:\Users\User 4\automation regressions\qa-report-20261001\issue-lifecycle.jpg)


## Evidence E14 - Earlier directory comparison - D01

253 total and 38 active users. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier directory comparison - D01](C:\Users\User 4\automation regressions\qa-report-20261001\accounts-253-users.jpg)


## Evidence E15 - Earlier global search - O03

No visible search result; unresolved. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier global search - O03](C:\Users\User 4\automation regressions\qa-report-20261001\global-search-no-result.jpg)


## Evidence E16 - Earlier SuperAdmin project creation

QAFYB creation result. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier SuperAdmin project creation](C:\Users\User 4\automation regressions\qa-report-20261001\project-created.jpg)


## Evidence E17 - Earlier zero-user dashboard

Earlier reproduction of D01. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier zero-user dashboard](C:\Users\User 4\automation regressions\qa-report-20261001\admin-zero-users.jpg)


## Evidence E18 - Earlier Gantt reproduction

Earlier reproduction of D02. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier Gantt reproduction](C:\Users\User 4\automation regressions\qa-report-20261001\gantt-invented-epic-dates.jpg)


## Evidence E19 - Earlier overview counts

Counting semantics remain to be confirmed. Screenshots reflect their capture time; later fixtures/edits may differ.

![Earlier overview counts](C:\Users\User 4\automation regressions\qa-report-20261001\project-overview-counts.jpg)
