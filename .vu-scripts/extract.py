import sys, re
from html.parser import HTMLParser

class TextExtractor(HTMLParser):
    DROP = {'script','style','noscript','nav','footer','head','svg','iframe'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip=0
        self.out=[]
        self.linebreak={'p','div','tr','li','h1','h2','h3','h4','h5','h6','br','table','section','article','ul','ol'}
    def handle_starttag(self,tag,attrs):
        if tag in self.DROP: self.skip+=1
        if tag in ('td','th'): self.out.append(' | ')
        if tag in self.linebreak: self.out.append('\n')
    def handle_endtag(self,tag):
        if tag in self.DROP and self.skip>0: self.skip-=1
        if tag in self.linebreak: self.out.append('\n')
    def handle_data(self,d):
        if not self.skip:
            self.out.append(d)

p=TextExtractor()
p.feed(open(sys.argv[1],encoding='utf-8',errors='replace').read())
text=''.join(p.out)
text=re.sub(r'[ \t\xa0]+',' ',text)
text=re.sub(r'\n\s*\n+','\n',text)
print(text.strip())
