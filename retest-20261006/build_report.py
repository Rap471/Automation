from pathlib import Path
template=Path(__file__).parent.parent/'retest-20261002/build_report.py'
exec(template.read_text(encoding='utf-8').split("story.extend([Spacer(1,35)")[0])
OUT=BASE/'output/pdf/FYB-Three-Role-Retest-20261006.pdf'
def p(s,st='BodyQA'):
 return Paragraph(html.escape(str(s).replace('\u2013','-').replace('\u2014','-')).replace('\n','<br/>'),styles[st])
rewrites={
7:('Retained issue data','Saved summary, link and comment persist','October 2 Member summary, Relates to QARA-1 and edited QA comment remain.'),
10:('Issue export','Produce a file and verify content','No download captured within 15 seconds; file content unverified.'),
11:('Undated epic Gantt','Avoid fabricated dates for unscheduled epics','Current Gantt shows 0 epics and 2 In Progress issues. Retained Planned epics are excluded; prior date symptom cannot be evaluated under changed scope.'),
12:('Epic availability','Prior epics remain readable','QA Role Epic and QA Member Epic remain in the Epic directory.'),
13:('Login','Authenticate Admin','Dashboard opens.'),
14:('Prior sprint persistence','Completed state retained','October 1 and 2 QA sprints remain Completed.'),
15:('Required sprint name','Show required-field validation','Sprint name is required displayed; no empty sprint created.'),
16:('Create QA sprint','Valid sprint becomes Planned','QA Retest Sprint 20261006 created Planned.'),
17:('Sprint assignment','Persist selected sprint','QARA-4 saved to QA Retest Sprint 20261006.'),
18:('Start sprint','Planned becomes Active','Complete sprint replaces Start sprint.'),
19:('Scoped sprint Board','Show assigned issue','Fresh sprint Board shows QARA-4 in To Do, 1 of 1 issue.'),
20:('Completion immediate refresh','Unfinished issue immediately returns to backlog','Sprint completed toast and sprint section removed; counters remain 1 in sprints / 0 backlog, with empty backlog. Reload shows 0 / 1 and QARA-4.'),
21:('Completion persisted state','Complete sprint and return unfinished work','After reload QARA-4 is in backlog. Current backlog excludes In Progress issues, so one parent is expected instead of the earlier three.'),
22:('Velocity consistency','Reflect completed state and avoid unsupported empty-data averages','Completed header and three completed QA sprints; report says No completed sprints yet and Average Completion Time 3.2 days with zero issues.'),
23:('Audit lifecycle','New QA changes traceable','Current QA sprint create/start/complete and QARA-4 update entries present.'),
24:('Login','Authenticate Member','Dashboard opens, no Admin navigation.'),
30:('My issues scope','Return only current Member assignment','QARA-2 assigned to sabye, one total.'),
31:('Singular grammar','Display 1 active issue','1 active issues still displayed.'),
32:('Clear My issues','Restore full QA list','Four QA issues restored.'),
33:('Other-author comment controls','Read comment without edit/delete controls','SuperAdmin comment visible; no comment Edit/Delete controls.'),
34:('Shared issue summary save','Member update preserves literal text','QARA-4 saved with Member retested 20261006 suffix, literal <tag> and &.'),
35:('Wiki Create feedback','Respond or explain restriction','+Create gives no response before/after selecting a space; Create at root opens page/folder menu.'),
36:('Wiki prototype save','Title, tags and author visible after Save','QA draft saved with qa/retest20261006 tags and Member email; editor explicitly says frontend-only localStorage prototype.'),
37:('Wiki Cancel metadata','Preserve author, tags and version; discard pending title','Original title, Member email, qa/retest20261006 tags and v3 remain after Cancel.'),
38:('Forbidden archive UI','Hide or disable prohibited archive','Enabled confirmation; server rejects Insufficient project role. QARA remains active.'),
39:('Project denial message','Explain project permission denial','Create rejected with You do not have permission to attach files to this issue. QAMR6 not created.'),
40:('Project settings restriction','Deny Member project management','Direct project settings redirects to Dashboard.'),
41:('Sprint management restriction','Allow reading with management unavailable','Three completed QA sprints visible; no Create/Start/Complete controls.'),
42:('Chat whitespace guard','Disable whitespace Send','Send disabled for three spaces; composer cleared without an actual message.'),
43:('Channel management restriction','Disable forbidden management','Members settings and Delete channel disabled; two members readable.'),
44:('Logout','End session','Signed-out login displayed.')}
for n,(feature,expected,actual) in rewrites.items():rows[n-1].update(feature=feature,expected=expected,actual=actual)
for r in rows:
 if r['feature'].startswith('Direct '):r['expected']='Deny administrative UI'
(ROOT/'report-results.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
story.extend([Spacer(1,35),p('FYB / QUALITY ASSURANCE','LabelQA'),p('Three-role\nRegression Retest','Title'),Spacer(1,18)])
body('6 October 2026 | Asia/Shanghai | Desktop UI testing')
body('https://dev-jira.fybtech.xyz/projects')
card('Assessment: further validation required',[('Results','44 recorded checks: 33 PASS, 9 FAIL, 1 INCONCLUSIVE, 1 NOT REPRODUCED under changed scope.'),('Changes','Wiki Cancel now preserves saved author/tags/version. Project required-field validation continues to pass. Planned epics no longer appear in Gantt; this does not prove the underlying date issue is fixed.'),('Remaining','Nine previously confirmed defect groups reproduced. Issue export remains inconclusive.'),('Contents','Test context; comparison with 2 October; defect reproduction; all 44 expected/actual checks; retained state and coverage limits; screenshot evidence.')])
section('Test context and role perspectives')
body('Fresh interactive UI retest performed on 6 October 2026. Previous results are compared only where matching scenarios were repeated; historical checks are not current passes. Evidence is visible DOM/accessibility snapshots and screenshots. Asynchronous responses were allowed to finish before classification.')
card('Accounts',[('SuperAdmin','rafael.pineda@patolomius.com - global SuperAdmin.'),('Admin','mocekij762@pumpoly.com - moce, global Admin / QARA Project Admin.'),('Member','sabaye4398@pumpoly.com - sabye, global User / QARA Member.')])
body('Expected behavior is based on labels, common UI behavior, role restrictions and consistency between views. No formal acceptance criteria were supplied. No source, API, database, performance, penetration, cross-browser or mobile testing was performed. Passwords are omitted.')
card('SuperAdmin perspective',[('Passed','Authentication, project validation/search, retained issue data, whitespace summary guard and Cancel.'),('Findings','Theme tooltip, preference names and administrative totals still fail. Export unverified. Gantt scope changed to In Progress issues; Planned epics remain available in the Epic directory.')])
card('Admin perspective',[('Passed','Created fresh sprint, assigned QARA-4, started sprint, verified scoped board, completed sprint and verified persisted return to backlog. Audit lifecycle records present.'),('Findings','Completion view stale until reload. Velocity says no completed sprints and 3.2-day average despite zero issues and Completed header.')])
card('Member perspective',[('Passed','Five direct admin-route denials, issue scope/reset, cross-author QA summary save, other-author comment restriction, Wiki save/Cancel, project settings restriction and chat guards.'),('Findings','Singular grammar, inert Wiki +Create, wrong project-denial text and enabled forbidden archive remain.')])
body('PASS covers only the stated outcome. FAIL can concern feedback despite correctly denied backend action. INCONCLUSIVE means an expected outcome was not established. NOT REPRODUCED under changed scope means the original symptom is not visible in the current scenario, not a verified code fix.')
section('Comparison with 2 October')
comparison=[('F01','Empty project validation','PASS','O004: Name/Key validation after completed response, consistent with 2 October.'),('F02','Theme tooltip','REPRODUCED','O002: Switch to dark theme remains in dark mode.'),('F03','Preference names','REPRODUCED','O003: Three unnamed checkboxes.'),('F04','Singular grammar','REPRODUCED','O031: 1 active issues.'),('F05','Wiki +Create','REPRODUCED','O035: No response; root menu works.'),('F06','Wiki Cancel metadata','NOT REPRODUCED / PASS','O037: saved author, tags and v3 preserved after Cancel. Original title restored.'),('D01','Admin user totals','REPRODUCED','O006: Dashboard 0 total / 0 active, loaded directory 255 / 41. Directory was 253 / 38 on 2 October.'),('D02','Undated Gantt epic','SCOPE CHANGED','O011: 0 epics, 2 In Progress issues. Planned QA epics excluded. Underlying fabricated-date fix not established.'),('D03','Member project denial','REPRODUCED','O039: Unrelated attachment error for project creation.'),('D04','Member archive UI','REPRODUCED','O038: Enabled action then Insufficient project role. Backend denial works.'),('N01','Completion stale view','REPRODUCED','O020: Immediate 1/0 and empty backlog; reload 0/1 with QARA-4.'),('N02','Velocity contradiction','REPRODUCED','O022: Completed header, No completed sprints yet, 3.2-day average for zero issues.'),('U021','Export download','INCONCLUSIVE','O010: No download captured within 15 seconds; file contents unverified.')]
for key,title,status,detail in comparison:card(key+' | '+title+' | '+status,[('Evidence',detail)])
body('Not reproduced does not prove a deployment or code fix. Current Gantt explicitly describes In Progress issues; Backlog now excludes the two In Progress QA issues. These scope differences are recorded as observations without inventing acceptance rules.')
section('Remaining defects - reproduction and impact')
defs=[
('D01 | Medium | Incorrect admin user totals','O006','SuperAdmin: open Admin dashboard, then Accounts after row data loads.','Dashboard Total/Active Users 0/0; directory 255/41. Recent user/audit data absent. Compare totals or show explicit unavailability.'),
('N01 | Medium | Stale completion view','O020','Admin: create October 6 QA sprint, assign QARA-4, Start, Complete in Backlog.','Success toast and sprint removed, but counters stay1/0 and no issue shown. Reload0/1 includes QARA-4. Persisted workflow works; refresh does not.'),
('N02 | Medium | Contradictory velocity report','O022','Admin: open completed QA Retest Sprint 20261006 > Velocity Report.','Completed header and three completed QA sprints; report No completed sprints yet and 3.2 days average with zero issues. Source/calculation not inspected.'),
('D03 | Medium | Wrong denial message','O039','Member: Add Project, name QA Member Permission Retest 20261006, key QAMR6, Create.','Project creation rejected with attachment permission error. Use project-specific feedback. No project created.'),
('D04 | Low | Forbidden archive offered','O038','Member: QARA project list > Archive project > Archive.','Enabled confirmation offered, server Insufficient project role. Project stays active. Hide/disable unsupported action.'),
('F02 | Low | Stale theme tooltip','O002','SuperAdmin: Toggle theme to dark, inspect tooltip.','Tooltip remains Switch to dark theme; target should be light. Light restored.'),
('F03 | Medium | Unnamed preference checkboxes','O003','SuperAdmin: Profile settings > Preferences.','Three unnamed checkboxes despite explanatory text. Assign distinct accessible names.'),
('F04 | Low | Singular grammar','O031','Member: Only my issues with one matching assignment.','1 active issues displayed. Use singular issue.'),
('F05 | Medium | Inert Wiki Create','O035','Member: Wiki +Create before/after Tististeng selection; compare Create at root.','No dialog/feedback from +Create, while root page/folder menu responds. Explain or activate the control.')]
for title,check,steps,actual in defs:card(title,[('Check',check),('Steps',steps),('Actual / impact',actual)])
for role in ['SuperAdmin','Admin','Member']:
 section(role+' - all recorded checks')
 for r in rows:
  if r['role']==role:
   entries=[('Expected',r['expected']),('Actual',r['actual'])]
   if r['prior']:entries.append(('Prior',r['prior']))
   card(r['id']+' | '+r['feature']+' | '+r['status'],entries)
section('Retained state and coverage limits')
card('QA state after this run',[('Project','QARA active. QAMR6 create denied; Member archive denied. Previous QA description/group retained.'),('Sprint','New QA Retest Sprint 20261006 Completed, zero issues, capacity0, Oct6-Oct6. October1/2 QA sprints remain Completed. QARA-4 returned to backlog.'),('Issue','QARA-4 summary: QA UI text <tag> & summary 20261001 - Member retested 20261006. To Do, Medium, Unassigned; prior relationship and edited comment retained.'),('Wiki','QA UI Draft20261001 saved in frontend prototype with qa/retest20261006 tags, Member author and v3. Those values preserved after Cancel.'),('Sessions','Logged out between roles and final Member session ended. Remember me unchecked. No password, global role, account or permanent deletion changes performed.')])
for s in ['All recorded checks from this run are included. This is not a certification that all functions work. Earlier page inventories and test records remain historical evidence and were not all repeated.','Export file generation/content remains unverified. Absence of a captured browser download is inconclusive, not a confirmed export failure.','Wiki editor explicitly states frontend-only prototype/localStorage. Server/shared persistence and backend data loss were not established.','Account mutations, password changes, reset-email delivery, lockout, session expiry, Remember me persistence and API authorization were not executed.','Uploads/download integrity, deletion, every transition combination, Kanban drag/drop, capacity/estimate reconciliation, configuration saves, concurrency and comprehensive report calculations remain unverified.','Chat sending, DM/group creation and notification delivery were not performed. Mobile/responsive, complete keyboard/screen-reader accessibility, cross-browser, timezone boundary, performance and security testing remain outside this pass.']:body(s)
section('Screenshot evidence')
pics=[('project-validation','E01 / O004 - Required project fields validated after response.'),('admin-dashboard','E02 / O006 - Zero user dashboard metrics.'),('accounts-loaded','E03 / O006 - Loaded directory 255 total,41 active.'),('gantt-current','E04 / O011 - Changed Gantt scope:0epics,2InProgressissues.'),('completion-immediate','E05 / O020 - Completion toast with stale1/0 and empty backlog.'),('completion-reloaded','E06 / O021 - Reloaded backlog0/1 includes QARA-4.'),('velocity','E07 / O022 - Contradictory completed-sprint report.'),('member-save','E08 / O034 - Member summary update saved.'),('wiki-before','E09 / O036 - Saved Wiki author,tags/version.'),('wiki-after','E10 / O037 - Cancel preserves saved metadata this time.'),('member-project','E11 / O039 - Wrong project denial text.')]
for i,(name,caption) in enumerate(pics):
 if i:story.append(PageBreak())
 story.append(p(caption,'Heading2'));w,h=PILImage.open(ROOT/(name+'.jpg')).size;scale=min(507/w,620/h)
 story.extend([Image(str(ROOT/(name+'.jpg')),width=w*scale,height=h*scale),Spacer(1,10),p('Point-in-time evidence. Expected/actual behavior and limitations are recorded in the matching check.','SmallQA')])
def footer(c,d):
 c.setStrokeColor(colors.HexColor('#DCE6EB'));c.line(44,40,551,40);c.setFont('QA',8);c.setFillColor(NAVY);c.drawString(44,27,'FYB | Three-role regression retest | 06 Oct 2026');c.drawRightString(551,27,str(d.page))
SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=43,bottomMargin=54,title='FYB Three-Role Regression Retest - 6 October 2026').build(story,onFirstPage=footer,onLaterPages=footer)
print(json.dumps({'output':str(OUT),'pages':len(PdfReader(OUT).pages),'counts':dict(counts)}))
