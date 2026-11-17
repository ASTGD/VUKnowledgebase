const fs=require('fs');
const DROP=new Set(['script','style','noscript','nav','footer','head','svg','iframe']);
const LB=new Set(['p','div','tr','li','h1','h2','h3','h4','h5','h6','br','table','section','article','ul','ol','option']);
let html=fs.readFileSync(process.argv[2],'utf8');
html=html.replace(/<!--([\s\S]*?)-->/g,'$1');
let skip=0,out='';
const re=/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)>/g;
let last=0,m;
function emitText(t){if(!skip){out+=t.replace(/\s+/g,' ');}}
while((m=re.exec(html))!==null){
  emitText(html.slice(last,m.index));
  last=re.lastIndex;
  const tag=m[1].toLowerCase(), closing=m[0][1]==='/';
  if(!closing){
    if(DROP.has(tag))skip++;
    if(tag==='td'||tag==='th')out+=' | ';
    if(LB.has(tag))out+='\n';
  } else {
    if(DROP.has(tag)&&skip>0)skip--;
    if(LB.has(tag))out+='\n';
  }
}
emitText(html.slice(last));
out=out.replace(/[ \t ]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
console.log(out);
