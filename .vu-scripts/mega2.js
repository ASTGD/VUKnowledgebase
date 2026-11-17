const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const parts=html.split('mega-menu-content');
for(let i=1;i<parts.length;i++){
 const body=parts[i];
 const re=/<h4[^>]*>([\s\S]*?)<\/h4>/g;
 const heads=[]; let m;
 while(m=re.exec(body)) heads.push(m[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
 const are=/<a[^>]*>([\s\S]*?)<\/a>/g;
 const links=[]; while(m=are.exec(body)) links.push(m[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
 console.log('--- block '+i+' HEADS: '+heads.filter(Boolean).join(' , '));
 console.log('LINKS: '+links.filter(Boolean).join(' | '));
}
