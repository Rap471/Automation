from pathlib import Path
import json,re,html
from collections import Counter
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image,PageBreak,KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader,PdfWriter
from PIL import Image as PILImage

ROOT=Path(__file__).parent; BASE=ROOT.parent
OUT=BASE/'output/pdf/FYB-Detailed-UI-and-Functions-QA-20261001.pdf'
TMP=BASE/'tmp/pdfs/detailed'; TMP.mkdir(parents=True,exist_ok=True)
rows=json.loads((ROOT/'results.json').read_text()); counts=Counter(r['status'].split(' -')[0] for r in rows)
pdfmetrics.registerFont(TTFont('QA','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('QAB','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('QA',normal='QA',bold='QAB',italic='QA',boldItalic='QAB')
NAVY=colors.HexColor('#19364D'); LIGHT=colors.HexColor('#F1F5F8'); TEAL=colors.HexColor('#087B82')
styles=getSampleStyleSheet()
for name in ['Title','Heading1','Heading2']:
 styles[name].fontName='QAB'; styles[name].textColor=NAVY
styles['Title'].fontSize=29; styles['Title'].leading=35
styles['Heading1'].fontSize=20; styles['Heading1'].leading=25; styles['Heading1'].spaceAfter=14
styles['Heading2'].fontSize=12; styles['Heading2'].leading=16; styles['Heading2'].spaceAfter=8
styles.add(ParagraphStyle(name='BodyQA',fontName='QA',fontSize=10,leading=14,spaceAfter=9,textColor=NAVY))
styles.add(ParagraphStyle(name='SmallQA',fontName='QA',fontSize=8.8,leading=12,spaceAfter=4,textColor=NAVY))
styles.add(ParagraphStyle(name='LabelQA',fontName='QAB',fontSize=8,leading=11,spaceAfter=4,textColor=TEAL))
def p(s,st='BodyQA'):
 s=str(s).replace('\u2013','-').replace('\u2014','-').replace('\u2011','-').replace('\u2192',' to ')
 return Paragraph(html.escape(s).replace('\n','<br/>'),styles[st])
story=[]
def body(s):story.append(p(s))
def section(s):story.extend([PageBreak(),p(s,'Heading1')])
def card(title,items):
 t=Table([[p(k,'LabelQA'),p(v,'SmallQA')] for k,v in items],colWidths=[78,429])
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
 story.append(KeepTogether([p(title,'Heading2'),t,Spacer(1,12)]))
story.extend([Spacer(1,40),p('FYB / QUALITY ASSURANCE','LabelQA'),p('Detailed UI &\nFunctions Test Report','Title'),Spacer(1,18)])
body('SuperAdmin, Admin and Member | 1 October 2026 | Asia/Shanghai')
body('Target: https://dev-jira.fybtech.xyz/projects')
card('Additional test pass',[('Coverage','59 recorded checks; button labels and states, summary/text, required fields, filters, cancellation, sprint lifecycle, comments, links, Wiki and role restrictions.'),('Results',', '.join(f'{v} {k}' for k,v in counts.items())),('Findings','6 distinct new defect groups across 7 failed checks. Earlier defects and full previous results are preserved in the historical appendix.'),('Assessment','Further validation required. This report does not certify every function. Inspected, disabled and inconclusive actions are distinguished from completed tests.')])
body('Contents: test method and role perspectives; new defects; observations; all 59 expected/actual checks; observed button/field inventory; remaining coverage; retained fixtures; screenshot evidence; complete previous report.')
section('Method and role perspectives')
body('Interactive desktop UI testing in the Codex in-app browser. Evidence comprises visible DOM/accessibility snapshots and screenshots. Expected behavior is inferred from labels, ordinary UI conventions and consistency between views. No formal acceptance criteria or permission specification was provided. No API, database, source-code, load, penetration, cross-browser or mobile testing was performed.')
card('Accounts used',[('SuperAdmin','rafael.pineda@patolomius.com - global SuperAdmin.'),('Admin','mocekij762@pumpoly.com - moce, global Admin and QARA Project Admin.'),('Member','sabaye4398@pumpoly.com - sabye, global User and QARA project Member.')])
body('Passwords are omitted. Tests used retained QA fixtures. No permanent deletion, password change, global role change or real chat message was performed. A QA issue and comment were created/edited, a QA sprint was started/completed, and QA project description/group data were saved.')
card('SuperAdmin perspective',[('Verified','Project search/sort, profile navigation, theme, issue summary validation/save/cancel, link create, comment add/edit, filters, calendar navigation, story point validation and project description/group save.'),('Findings','Empty project form lacks visible feedback; dark-mode tooltip is stale; preference checkboxes lack accessible names. System maintenance and Enabled Pages controls are disabled.')])
card('Admin perspective',[('Verified','Issue sprint assignment, sprint start, board membership, sprint completion with unfinished work returned to backlog; epic/sprint required-name messages; account filter; audit empty state/reset/metadata.'),('Observation','Backlog membership initially appeared stale; revisit/reload showed the saved assignment. This is an observed transient inconsistency, not a proven persistent defect.')])
card('Member perspective',[('Verified','My issues/status filters, cross-author shared issue summary edit, other-author comment restrictions, channel member restrictions, whitespace message validation, password form cancellation, five direct admin-route denials.'),('Findings','Count grammar is incorrect. Wiki +Create gives no response. Wiki Cancel restored the title but changed author/version and removed tags. Wiki explicitly identifies itself as a localStorage prototype.')])
body('PASS covers only the stated outcome. INSPECTED means the form/menu was examined without completing the workflow. OBSERVATION needs further clarification or repeat validation. INCONCLUSIVE means the expected outcome could not be established. A failed text/feedback check does not automatically imply failed backend authorization.')
section('New defects - reproduction and impact')
defs=[
('F01 | Medium | Empty project submission','U009','SuperAdmin: Projects > Add Project. Leave fields empty and click enabled Create.','Disable invalid submission or show field-specific required messages.','Form remains without visible validation or creation. Users cannot tell what to correct.'),
('F02 | Low | Stale theme tooltip','U005','SuperAdmin: click Toggle theme to dark appearance; inspect tooltip.','Tooltip should describe switching to light theme.','Appearance changes to dark, but tooltip still says Switch to dark theme. Light appearance was restored.'),
('F03 | Medium | Unnamed preference checkboxes','U006','SuperAdmin: Settings > Preferences. Inspect checkbox accessible names.','Each preference checkbox should have a distinct accessible name.','Three checkboxes have no accessible names, although explanatory text is visible. Assistive technology cannot identify them reliably.'),
('F04 | Low | Singular count wording','U036','Member: Only my issues with one matching issue; view completed sprint heading.','1 active issue and 1 completed sprint.','UI displays 1 active issues and 1 completed sprints.'),
('F05 | Medium | Wiki +Create has no feedback','U045, U047','Member: open Wiki, click +Create before and after selecting a space. Compare Create at root.','Open creation options or explain why creation is unavailable.','+Create produces no dialog or feedback; Create at root opens page/folder options. Two failed checks represent one defect group.'),
('F06 | Medium | Wiki Cancel changes saved metadata','U048','Member: save QA UI Draft 20261001 with qa/regression tags (v2). Edit title, then Cancel.','Discard pending title edit and preserve saved author, version and tags.','Title reverts, but author changes from sabaye4398 to api@system, version v2 to v0, tags disappear. UI metadata regression; server data loss is not established.')]
for title,ids,steps,exp,act in defs:card(title,[('Checks',ids),('Steps',steps),('Expected',exp),('Actual',act)])
section('Observations and unverified outcomes')
for title,items in [
('Malformed login email - U002',[('Actual','Input type text accepted malformed email and returned generic login failure. No format-specific feedback.'),('Follow-up','Consider email-format validation while retaining non-disclosing credential/recovery messages.')]),
('Calendar overflow - U022',[('Actual','Next/Today month navigation passed. Fourth event was represented by generic +1 more text, without button/link semantics.'),('Limit','Opening the hidden event was not verified; review keyboard access and overflow behavior.')]),
('Backlog refresh - U027',[('Actual','Assignment initially showed stale zero sprint membership; fresh revisit/reload showed one sprint issue and two backlog parents.'),('Follow-up','Check cache invalidation and immediate navigation behavior with a repeat controlled scenario.')]),
('Issue Export - U021',[('Actual','Clicked Export, which briefly disabled. No download was captured within 10 seconds.'),('Limit','File production and contents remain unverified. This is inconclusive, not a confirmed export failure.')]),
('Disabled configuration - U055, U059',[('Actual','System service/resources Unknown; diagnostic/maintenance/configuration actions disabled. Enabled Pages toggles all disabled and all named toggle; Timeline unchecked while Gantt navigation remains present.'),('Follow-up','Explain disabled actions and define Timeline/Gantt relationship. No configuration mutation was possible.')]),
('Accounts and analytics semantics',[('Actual','Admin role filter returned four Admin rows while broader Admins metric showed 15. SuperAdmin analytics displayed global totals; those totals were inspected, not independently reconciled.'),('Limit','Clarify whether Admins includes SuperAdmins and define scope. Do not infer a defect solely from different metric semantics.')])]:card(title,items)
for role in ['Signed out','SuperAdmin','Admin','Member']:
 section(role+' - detailed checks')
 for r in rows:
  if r['role']==role:card(r['id']+' | '+r['feature']+' | '+r['status'],[('Expected',r['expected']),('Actual',r['actual'])])
section('Observed button and field inventory')
body('Inventory of controls visible in captured page snapshots. This is a presence/label/state record, not evidence that every listed action was submitted. Captures are point-in-time and may omit delayed controls, hidden menus, pagination and modal-only actions. Shared navigation is excluded. Erroneous settings captures were excluded rather than attributed to the wrong panel.')
inventory=[]
for f in sorted(ROOT.glob('*.txt')):
 if 'Settings-' in f.name or f.name in ['login.txt','forgot-password.txt']:continue
 txt=f.read_text(encoding='utf-8'); main=txt.split('- main:',1)[-1] if '- main:' in txt else txt
 heads=re.findall(r'- heading "([^"]+)"',main)
 buttons=[]; fields=[]; anon=0
 for line in main.splitlines():
  m=re.search(r'- (button|textbox|searchbox|combobox|checkbox|spinbutton|switch)(?: "([^"]*)")?(.*)',line)
  if not m:continue
  kind,label,tail=m.groups(); label=label or '(unnamed)'
  if '[disabled]' in tail:label+=' [disabled]'
  if kind=='button':
   if label=='(unnamed)':anon+=1
   elif label not in buttons:buttons.append(label)
  else:
   val=kind+': '+label
   if val not in fields:fields.append(val)
 name=f.stem.replace('-',' / ')
 inventory.append({'page':name,'headings':heads,'buttons':buttons,'fields':fields,'unnamed_buttons':anon})
 card(name,[('Headings',', '.join(dict.fromkeys(heads)) or 'No heading captured'),('Buttons','; '.join(buttons) or 'No named main-page buttons captured'),('Fields','; '.join(fields) or 'No main-page fields captured'),('Icons',str(anon)+' unnamed button instance(s) in snapshot')])
(ROOT/'validated-inventory.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')
section('Coverage limits and retained fixtures')
body('The request for all functions is covered through the recorded workflows and page/control inventory. Full correctness cannot be certified for unexecuted actions. Remaining gaps are explicit so page inspection is not mistaken for end-to-end verification.')
for title,text in [
('Accounts and security','Account creation/edit/deactivation/deletion, privileged-account changes, password updates, reset-email delivery, lockout, session expiry and Remember me persistence remain unexecuted. Member direct UI routes were denied; API authorization was not tested.'),
('Projects and planning','Dependency/workflow settings and every transition combination remain unexecuted. Story point invalid-input blocking passed without saving a configuration. Enabled Pages/System actions were disabled. Kanban-specific drag/drop, multiple active sprints, capacity/estimate calculations and report reconciliation remain unverified.'),
('Issues and files','Summary, comment edit and link create passed. Attachment upload/download integrity, link deletion, comment deletion, permanent issue deletion, export content and concurrent editing remain unverified.'),
('Chat, notifications and Wiki','Recipient/group forms and whitespace validation were inspected. Sending messages, group creation, notification delivery, channel changes and message editing/deletion were not executed. Wiki save was a local prototype UI check; publishing, shared/backend persistence, uploads, restore and comments remain unverified.'),
('Layout and accessibility','This desktop pass found accessible-name issues but is not a WCAG audit. Mobile, browser compatibility, full keyboard navigation, timezone boundary and performance checks remain unexecuted.')]:card(title,[('Remaining',text)])
card('Current QA state - overrides older appendix',[('Project','QARA remains active. Description: Disposable role-based functional QA fixture. UI summary & description verified 20261001. Project group QA UI saved, lead Unassigned, status Active.'),('New issue','QARA-4: QA UI text <tag> & summary 20261001 - Member verified. Task, To Do, Medium, Unassigned. Relates to QARA-1. Comment: QA detail comment edited 20261001.'),('Sprint','QA Role Sprint 20261001 is now Completed. Unfinished QARA-4 returned to backlog. Older appendix describes its earlier Planned state.'),('Wiki','QA UI Draft 20261001 in Tististeng; draft ID 6f667d9b-f9e9-46c3-be60-6af91904aa64. Local prototype draft retained; metadata changed after Cancel.'),('Other','Previously retained QARA-1/2/3, epics, QAFYB and SPS QA fixtures remain. No permanent cleanup was performed.')])
section('Screenshot evidence - additional pass')
pics=[('dark-theme.jpg','E01 / U005 - Dark appearance; theme tooltip text defect recorded in DOM.'),('empty-project-validation.jpg','E02 / U009 - Empty project form, enabled Create, no required-field feedback.'),('summary-comment-link.jpg','E03 / U011-U017 - QA issue literal summary, link and comment; captured before later Member summary edit.'),('admin-sprint-completed.jpg','E04 / U028 - QA sprint Completed after Admin lifecycle test.'),('member-cross-author-controls.jpg','E05 / U039-U040 - Member view after summary edit; other-author comment controls restricted.'),('wiki-qa-draft.jpg','E06 / U046 - Saved Wiki prototype draft and metadata before Cancel.'),('wiki-cancel-metadata-reset.jpg','E07 / U048 - Metadata changed after Wiki Cancel.')]
for idx,(name,caption) in enumerate(pics):
 if idx:story.append(PageBreak())
 story.append(p(caption,'Heading2'))
 w,h=PILImage.open(ROOT/name).size; scale=min(507/w,625/h)
 story.extend([Image(str(ROOT/name),width=w*scale,height=h*scale),Spacer(1,10),p('Screenshot is point-in-time evidence. The relevant test card records the expected and actual behavior.','SmallQA')])
section('Historical appendix - previous full report')
body('The following original 39-page report preserves all 37 earlier role comparison checks, all 54 earlier SuperAdmin checks, defect reproduction details and screenshots. These are previous runs on 1 October 2026. They were not all repeated in this additional pass. Earlier fixture descriptions and coverage gaps must be read with the current state and completed-work overrides above.')
body('Total recorded across the three passes: 150 check records (59 additional + 37 earlier role comparison + 54 initial). These are not 150 unique functions or a 100% coverage claim. Multiple checks overlap or reproduce the same defect.')
def footer(c,d):
 c.setStrokeColor(colors.HexColor('#D8E3EA'));c.line(44,40,551,40)
 c.setFont('QA',8);c.setFillColor(NAVY);c.drawString(44,27,'FYB | Detailed UI/functions pass | 01 Oct 2026');c.drawRightString(551,27,str(d.page))
new=TMP/'additional-pass.pdf'
SimpleDocTemplate(str(new),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=43,bottomMargin=54,title='FYB Detailed UI and Functions QA',author='QA testing').build(story,onFirstPage=footer,onLaterPages=footer)
writer=PdfWriter();writer.append(str(new));writer.append(str(BASE/'output/pdf/FYB-All-Roles-QA-Report-20261001.pdf'))
writer.add_metadata({'/Title':'FYB Detailed UI and Functions QA - all roles','/Subject':'Additional 59 checks with full historical appendix'})
with OUT.open('wb') as fp:writer.write(fp)
print(json.dumps({'output':str(OUT),'new_pages':len(PdfReader(new).pages),'total_pages':len(PdfReader(OUT).pages),'counts':dict(counts),'inventory_pages':len(inventory)}))
