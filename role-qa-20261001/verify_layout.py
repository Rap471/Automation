from pathlib import Path
from PIL import Image,ImageDraw
import pdfplumber,json
root=Path(__file__).parent.parent
files=sorted((root/'tmp/pdfs').glob('role-page-*.png'))
for start in range(0,len(files),8):
    subset=files[start:start+8]
    canvas=Image.new('RGB',(1600,1180),'#dbe3ea');draw=ImageDraw.Draw(canvas)
    for i,f in enumerate(subset):
        img=Image.open(f).convert('RGB');img.thumbnail((380,550))
        x=(i%4)*400+10;y=(i//4)*590+25
        canvas.paste(img,(x,y));draw.text((x,y-20),f'Page {start+i+1}',fill='black')
    canvas.save(root/'tmp/pdfs'/f'role-contact-{start//8+1}.jpg')
issues=[]
with pdfplumber.open(root/'output/pdf/FYB-All-Roles-QA-Report-20261001.pdf') as pdf:
    for n,p in enumerate(pdf.pages,1):
        for ch in p.chars:
            if ch['x0']<40 or ch['x1']>p.width-40 or ch['top']<18 or ch['bottom']>p.height-20:
                issues.append({'page':n,'char':ch['text'],'box':[ch['x0'],ch['top'],ch['x1'],ch['bottom']]})
print(json.dumps({'pages':len(files),'out_of_bounds_text':issues[:20],'issue_count':len(issues)}))
