const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const re=/<li class="nav-item dropdown mega-menu">[\s\S]*?<div class="mega-menu-content">([\s\S]*?)<\/li>\s*<li class="nav-item dropdown mega-menu">|\s*$/g;
// simpler: split by mega-menu-content
const parts=html.split('mega-menu-content');
for(let i=1;i<parts.length;i++){
 const body=parts[i].split('</li>')[0];
 const txt=(body.match(/<h[0-9][^>]*>([\s\S]*?)<\/h[0-9]>|<a[^>]*>([\s\S]*?)<\/a>/g)||[]).map(m=>m.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
 console.log('--- block '+i+': '+txt.slice(0,30).join(' | '));
}
