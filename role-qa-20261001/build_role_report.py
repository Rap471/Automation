from pathlib import Path
import json, re, html
from collections import Counter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

ROOT=Path(__file__).parent
OLD=ROOT.parent/'qa-report-20261001'
OUT=ROOT.parent/'output/pdf/FYB-All-Roles-QA-Report-20261001.pdf'
rows=json.loads((ROOT/'results.json').read_text())
counts=Counter(x['status'].split(' -')[0] for x in rows)
pdfmetrics.registerFont(TTFont('QA','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('QAB','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('QA',normal='QA',bold='QAB',italic='QA',boldItalic='QAB')
NAVY=colors.HexColor('#17344B'); TEAL=colors.HexColor('#147B83'); GRAY=colors.HexColor('#566675'); LIGHT=colors.HexColor('#F1F5F8')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyQA',fontName='QA',fontSize=10,leading=15,spaceAfter=8,textColor=NAVY))
styles.add(ParagraphStyle(name='SmallQA',fontName='QA',fontSize=8.7,leading=12.5,spaceAfter=5,textColor=NAVY))
styles.add(ParagraphStyle(name='LabelQA',fontName='QAB',fontSize=8,leading=11,spaceAfter=4,textColor=TEAL))
styles.add(ParagraphStyle(name='CardQA',fontName='QAB',fontSize=10,leading=14,spaceAfter=6,textColor=NAVY))
for n in ['Title','Heading1','Heading2']:
    styles[n].fontName='QAB'; styles[n].textColor=NAVY
styles['Title'].fontSize=31; styles['Title'].leading=38
styles['Heading1'].fontSize=20; styles['Heading1'].leading=26; styles['Heading1'].spaceAfter=15
styles['Heading2'].fontSize=13; styles['Heading2'].leading=18; styles['Heading2'].spaceBefore=10; styles['Heading2'].spaceAfter=8
def clean(s):
    return s.replace('—','-').replace('–','-').replace('→',' to ').replace('‑','-')
def p(s,style='BodyQA'):
    s=html.escape(clean(str(s))).replace('\n','<br/>')
    s=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s)
    return Paragraph(s,styles[style])
story=[]; md=[]
def heading(t):
    story.extend([PageBreak(),p(t,'Heading1')]);md.append('\n## '+t+'\n')
def body(t):
    story.append(p(t));md.append(t+'\n')
def card(title, entries, status=None):
    headingtxt=title+(' | '+status if status else '')
    cells=[[p(k.upper(),'LabelQA'),p(v,'SmallQA')] for k,v in entries]
    tb=Table(cells,colWidths=[88,419],hAlign='LEFT')
    tb.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#DCE6EB'))]))
    story.append(KeepTogether([p(headingtxt,'CardQA'),tb,Spacer(1,11)]))
    md.extend(['\n### '+headingtxt+'\n']+[f'**{k}:** {v}\n' for k,v in entries])

md.append('# FYB QA report - all three roles\n')
story.extend([Spacer(1,45),p('FYB TECHNOLOGIES / QUALITY ASSURANCE','LabelQA'),p('Role-based\nFunctional QA Report','Title'),Spacer(1,20),p('SuperAdmin, Admin and Member\n1 October 2026 | Desktop browser testing'),p('https://dev-jira.fybtech.xyz/projects','SmallQA'),Spacer(1,22)])
stats=Table([[p('3','Heading1'),p('37','Heading1'),p('54','Heading1')],[p('Role accounts tested','SmallQA'),p('New role comparison checks','SmallQA'),p('Earlier SuperAdmin checks included','SmallQA')]],colWidths=[169]*3)
stats.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
story.extend([stats,Spacer(1,22),p('Assessment: further validation required','Heading2'),p('Core project and issue workflows work in the tested role scenarios. Four confirmed defects remain. This report does not certify every function: destructive actions, account/security changes, some reports and exports, and several communication workflows were not completed.'),p('Contents','Heading2'),p('1. Test context and role perspectives\n2. Capability comparison\n3. Confirmed defects and observations\n4. All 37 role comparison checks\n5. All 54 earlier SuperAdmin checks\n6. Retained fixtures and coverage gaps\n7. Screenshot evidence')])
heading('Test context and role perspectives')
body('Target: https://dev-jira.fybtech.xyz. Date: 1 October 2026, Asia/Shanghai. Method: interactive Codex in-app browser, DOM/accessibility observations and screenshots. Desktop only. No source, API, database, load or security penetration testing. Passwords are omitted.')
body('Expected results are inferred from control labels, ordinary application behavior, role hierarchy and consistency between application views. No formal permission specification or acceptance criteria was supplied. An unexpected capability is reported as an observation unless the intended rule is established.')
card('Accounts verified',[('SuperAdmin','rafael.pineda@patolomius.com | rafael.pineda | global SuperAdmin / Active'),('Admin','mocekij762@pumpoly.com | moce | global Admin / Active; QARA Project Admin'),('Member','sabaye4398@pumpoly.com | sabye | global User / Active; QARA Member after fixture setup')])
body('Global account role and project role are separate. Admin and Member initially had no projects in the directory. Admin created QARA and automatically became its Project Admin. The supplied Member was added only to this QA project, containing ordinary test data, to allow a fair comparison of project workflows. No global roles were changed.')
card('SuperAdmin point of view',[('Scope','Dashboard showed 80 active projects and global recent activity. QARA settings accessible without project membership.'),('Working','Original 54-check run covered project create/edit/archive/restore, issue/comment/subtask/epic/sprint workflows and navigation. Current run verified cross-role edit and full create-user role options.'),('Problems','Administration user metrics remain zero despite populated directory. Gantt defect reproduced previously and under Admin/Member.')])
card('Admin point of view',[('Scope','Admin navigation, full account directory, global audit and analytics visible. Project dashboard initially empty until QARA creation.'),('Working','Created project, added Member, created/edited/transitioned/self-assigned issue, created sprint and epic. Actor audit filter returned 21 matching records.'),('Restrictions','Self-delete disabled; new-user form excludes SuperAdmin; existing SuperAdmin role dropdown disabled. Other privileged-account changes not submitted.')])
card('Member point of view',[('Before','No projects; zero dashboard metrics; Admin route denied; unrelated project settings redirected. Wiki spaces and one assignment notification visible.'),('After','QARA visible with role Member. Issue create/edit/transition/self-assignment/watch/subtask passed; project chat became available.'),('Restrictions','Project settings hidden/direct route redirected. Sprint creation and management hidden. Project archive denied. Epic creation succeeds; intended policy needs confirmation.')])
body('Status meanings: PASS verifies only the stated behavior. Form/load-only passes do not verify submission. FAIL identifies the stated defect, which may be feedback rather than a backend authorization failure. OBSERVATION needs product-policy clarification. BLOCKED identifies an unestablished outcome.')
body('Current 37 checks: '+', '.join(f'{v} {k.lower()}' for k,v in counts.items())+'. Counts are checks, not distinct defects. Several checks reproduce the same defect. The earlier 54 checks are separately identified and must not be treated as 91 independent full end-to-end workflows.')

heading('Observed capability comparison')
matrix=[['Function','SuperAdmin','Admin','Member'],['Project scope','Global projects','Assigned/created','Assigned only'],['Administration','Available','Available','Direct /admin denied'],['New-user roles','User/Admin/SuperAdmin*','User/Admin*','Admin unavailable'],['Create project','Succeeded (QAFYB)','Succeeded (QARA)','Denied; wrong message'],['Project settings','Global access','Own Project Admin','Hidden; direct redirect'],['Add project Member','Inspected previously','Succeeded in QARA','Settings unavailable'],['Create/edit issue','Succeeded','Succeeded','Succeeded in QARA'],['Status/self-assign','Succeeded','Succeeded','Succeeded'],['Subtask/watch','Succeeded','Not repeated fully','Succeeded'],['Create epic','Succeeded','Succeeded','Succeeded; policy open'],['Create sprint','Succeeded','Succeeded','Hidden'],['Start/complete sprint','Not executed','Not executed','Management hidden'],['Archive/restore project','Succeeded (QAFYB)','Not repeated','Denied; enabled control'],['Board/calendar/backlog','Loaded','Loaded','Loaded'],['Gantt undated epic','Incorrect date fallback','Same defect','Same display'],['User metrics','Wrong zero totals','Wrong zero totals','Admin unavailable'],['Chat/wiki','Read/search only','Wiki read only','Chat/wiki read only']]
mt=Table([[p(c,'SmallQA') for c in r] for r in matrix],colWidths=[122,128,128,129],repeatRows=1)
mt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#DCE9EE')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,LIGHT]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
story.append(mt);md.extend([' | '.join(r)+'\n' for r in matrix]);body('* New-user form inspected only. No user accounts were created or elevated. Backend denial is established only for actions actually submitted; hidden controls alone do not prove server authorization.')

heading('Confirmed defects')
defects=[('D01 - Administration user metrics are incorrect','Medium','Admin and SuperAdmin','Open /admin, compare /admin/accounts and /admin/audit-logs.','Dashboard should show consistent system data or explicit unavailable/error state.','Dashboard Total Users 0, Active Users 0, no recent users/audits. Directory 253 total, 38 active, 215 inactive, 15 admins. Admin audit page had 4558 records before new fixtures; actor filter returned 21.','A04, S06; prior D01'),('D02 - Gantt invents dates for an undated epic','Medium','SuperAdmin, Admin; visible to Member','Create epic without start/end dates; open Gantt.','Show unscheduled or clearly label visualization fallback, rather than actual dates.','QA Role Epic 20261001, created with blank dates, displayed Oct 1, 2025 to Oct 1, 2027. Earlier SPS epic detail said Not set.','A12, M13; prior D02'),('D03 - Member project denial uses attachment error','Medium','Member','With no project memberships, Add Project; name QA Role Member 20261001, key QARM, Kanban; submit Create.','Relevant project-creation denial; controls should reflect permission.','No project created. Message: You do not have permission to attach files to this issue. No attachment operation was performed.','M02'),('D04 - Member has enabled project archive control','Low','Member','On QARA project list, click Archive project; confirm QA-only archive.','Hide/disable forbidden archive or explain permission before confirmation.','Confirmation is offered; submission returns Insufficient project role; QARA remains active. Backend restriction works; defect is misleading UI.','M15')]
for title,sev,roles,steps,exp,act,refs in defects:
    card(title,[('Severity',sev+' | '+roles),('Reproduce',steps),('Expected',exp),('Actual',act),('Checks',refs)])
heading('Observations requiring follow-up')
card('O05 - Member can create epics',[('Actual','Member successfully created QARA-4AD804 while Create Sprint is hidden. No requirements specify whether this difference is intended.'),('Follow-up','Confirm permission matrix for epic create/edit/delete and sprint management. Do not label a privilege escalation without policy/backend validation.')])
card('O06 - Admin privileged-account controls',[('Actual','Existing SuperAdmin row exposes Edit/Assign/Delete. Edit disables Role but leaves Name, Email and Active controls editable. No changes submitted.'),('Follow-up','Validate intended rules using disposable accounts and an approved security test. Visible controls do not establish backend authorization.')])
card('O07 - Administrative scope and availability',[('Actual','Admin analytics shows global issue counts, while project overview is membership-scoped. System service/resource statuses show Unknown. Wiki lists shared spaces even when user has no projects.'),('Follow-up','Document intended scope and availability states. No claim of unauthorized data exposure is established.')])
card('O01-O04 - Earlier unresolved observations',[('Counts','Overview appears to exclude subtasks; current QARA directory says 2 issues while issue list/calendar includes 3. Clarify labels/counting rules.'),('Velocity','Earlier empty sprint showed Average Completion Time 3.2 days. Current Admin sprint detail follow-up blocked by browser stall.'),('Search/export','Earlier global search produced no visible result; issue export captured no download. Current local issue-key search passed. Export content remains unverified.')])

for role,label in [('SuperAdmin','SuperAdmin checks - current run'),('Admin','Admin checks - current run'),('Member','Member checks - current run')]:
    heading(label)
    for r in rows:
        if r['role']==role:card(r['id']+' - '+r['feature'],[('Expected',r['expected']),('Actual',r['actual'])],r['status'])
heading('SuperAdmin checks - earlier 54-check run')
body('These checks were performed earlier on 1 October 2026 using the same SuperAdmin account. They are preserved here in full. They are historical results from that run, not a claim that each operation was repeated for Admin and Member.')
for line in (OLD/'Functional-QA-Report.md').read_text(encoding='utf-8').splitlines():
    if re.match(r'\| T\d\d \|',line):
        cols=[x.strip() for x in line.strip('|').split('|')]
        card(cols[0]+' - '+cols[1],[('Expected',cols[2]),('Actual',cols[3])],cols[4])

heading('Retained test fixtures')
body('QA objects are retained for reproducibility. No permanent deletion or account change was performed. The Member session was logged out on the recovered tab. A prior browser tab stalled during Admin sprint-detail navigation; that tab/session could not be inspected to confirm logout.')
card('Current role fixture: QARA',[('Project','QA Role Admin 20261001 | Scrum | active | moce Project Admin; sabye Member. No real project data added or exposed.'),('Issues','QARA-1: QA Admin role lifecycle 20261001 - SuperAdmin verified; In Progress, High, assigned moce. QARA-2: QA Member role lifecycle 20261001 - verified; In Progress, Medium, assigned sabye, unwatched. QARA-3: QA Member subtask 20261001; To Do, under QARA-2.'),('Epics','QARA-26778F: QA Role Epic 20261001; Planned, blank dates. QARA-4AD804: QA Member Epic 20261001; Planned, blank dates.'),('Sprint','QA Role Sprint 20261001; planned, empty, capacity 0.'),('Denied','QARM was not created. Member archive failed, QARA remains active.')])
card('Earlier fixtures retained',[('Project','QAFYB: QA Functional Regression 20261001 - verified; active/restored, unfavorited, Scrum, no issues.'),('Issues','SPS-19: QA Regression 20261001 - edited lifecycle; In Progress, High, assigned rafael.pineda, one QA comment, unwatched, associated QA epic. SPS-20: To Do subtask.'),('Planning','SPS-0FEBD0: QA Regression Epic 20261001; originally undated. QA Regression Sprint 20261001: planned, empty.')])
heading('Coverage gaps and next steps')
body('This is a functional and role comparison test report, not an all-functions-correct sign-off. User journeys were tested where stated; page loads and form inspection were not substituted for mutation verification.')
for t in ['Account creation/edit/deactivation/deletion, global role changes, passwords, forgot-password email, lockout/session expiration and Remember me persistence were not submitted or fully validated. Permanent deletion requires a separate approved test.','Sprint assignment/start/complete, estimates/capacity and complete transition combinations remain unverified. Admin sprint report follow-up was blocked by a browser timeout; clean-tab recovery worked. This is not filed as an app defect.','Attachments/uploads/download integrity, issue links, comment editing/deletion, issue archive/restore and export contents remain unverified. Kanban-specific workflows, drag/drop and concurrent updates remain untested.','Project workflow/dependency/story-point/enabled-page/group setting saves were inspected but not submitted. No global roles changed. Existing privileged-account backend protections were not probed.','Chat sending, direct messages/groups, channel changes and notification delivery were not executed. Wiki create/edit/publish/restore/comments/uploads were not executed. Read access alone does not prove all write functions.','Cross-browser/mobile/responsive layouts, accessibility conformance, timezone edge cases, performance, API authorization and security penetration testing remain outside this run.']:
    body('- '+t)
body('Recommended order: fix D01-D04; confirm epic and privileged-account policies; retest unresolved search/export/velocity/count observations in a standard browser; complete remaining workflows with approved disposable fixtures; require persistence and exported-file validation before release sign-off.')

evidence=[(ROOT,'member-create-denied-wrong-message.jpg','Member project creation - D03','Wrong attachment permission message after project submission.'),(ROOT,'member-admin-denied.jpg','Member direct Admin denial','Access denied verifies navigation restriction.'),(ROOT,'admin-account-role.jpg','Admin account and directory','moce verified as Admin; populated statistics.'),(ROOT,'admin-project-created.jpg','Admin project creation','QARA persisted with Project Admin role.'),(ROOT,'admin-member-fixture.jpg','QA-only membership','moce Project Admin and sabye Member in the fixture.'),(ROOT,'admin-gantt-fabricated-dates.jpg','Gantt dates - D02','Blank-date epic shown with concrete two-year range.'),(ROOT,'member-issue-lifecycle.jpg','Member issue and subtask','QARA-2 persisted; child and history visible.'),(ROOT,'member-epic-created.jpg','Member epic capability - O05','Member-created epic visible alongside Admin epic.'),(ROOT,'member-archive-result.jpg','Member archive denial - D04','Insufficient project role; project remains active.'),(ROOT,'superadmin-cross-role-edit.jpg','SuperAdmin cross-role editing','SuperAdmin updated Admin-created issue.'),(ROOT,'superadmin-dashboard-metrics.jpg','SuperAdmin dashboard - D01','Zero user counts and absent recent audit data.'),(ROOT,'admin-superadmin-edit-role-disabled.jpg','Privileged account form - O06','Admin sees SuperAdmin edit form; Role disabled, other changes unsubmitted.'),(OLD,'issue-lifecycle.jpg','Earlier SuperAdmin lifecycle','SPS-19 and QA subtask/comment work.'),(OLD,'accounts-253-users.jpg','Earlier directory comparison - D01','253 total and 38 active users.'),(OLD,'global-search-no-result.jpg','Earlier global search - O03','No visible search result; unresolved.'),(OLD,'project-created.jpg','Earlier SuperAdmin project creation','QAFYB creation result.'),(OLD,'admin-zero-users.jpg','Earlier zero-user dashboard','Earlier reproduction of D01.'),(OLD,'gantt-invented-epic-dates.jpg','Earlier Gantt reproduction','Earlier reproduction of D02.'),(OLD,'project-overview-counts.jpg','Earlier overview counts','Counting semantics remain to be confirmed.')]
for n,(folder,filename,title,caption) in enumerate(evidence,1):
    heading(f'Evidence E{n:02} - {title}')
    body(caption+' Screenshots reflect their capture time; later fixtures/edits may differ.')
    img=Image(str(folder/filename));s=min(507/img.imageWidth,605/img.imageHeight)
    img.drawWidth=img.imageWidth*s;img.drawHeight=img.imageHeight*s
    story.extend([Spacer(1,10),img]);md.append(f'![{title}]({folder/filename})\n')

def footer(c,d):
    w,h=A4;c.setStrokeColor(colors.HexColor('#DCE6EB'));c.line(44,40,w-44,40)
    c.setFont('QA',8);c.setFillColor(GRAY);c.drawString(44,27,'FYB | Three-role functional QA | 1 October 2026');c.drawRightString(w-44,27,str(d.page))
    if d.page>1:c.drawString(44,h-27,'ROLE COMPARISON AND TEST EVIDENCE')
OUT.parent.mkdir(parents=True,exist_ok=True)
doc=SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=49,bottomMargin=55,title='FYB All Roles QA Report - 1 October 2026',author='Codex')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
(ROOT/'FYB-All-Roles-QA-Report.md').write_text(clean('\n'.join(md)),encoding='utf-8')
rd=PdfReader(str(OUT));txt='\n'.join(x.extract_text() for x in rd.pages)
for r in rows:assert r['id'] in txt,r['id']
for n in range(1,55):assert f'T{n:02}' in txt
assert 'Royrap28' not in txt
validation={'pages':len(rd.pages),'current_checks':len(rows),'current_statuses':dict(counts),'prior_checks':54,'images':sum(len(x.images) for x in rd.pages),'pdf':str(OUT)}
(ROOT/'validation.json').write_text(json.dumps(validation,indent=2))
print(json.dumps(validation))
