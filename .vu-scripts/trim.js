const fs=require('fs');
for(const f of process.argv.slice(2)){
 let lines=fs.readFileSync(f,'utf8').split('\n');
 let i=lines.findIndex(l=>/^\s*OVERVIEW\s*$/.test(l));
 if(i<0)i=lines.findIndex(l=>/Student Login Modal/.test(l));
 if(i<0)i=0;
 fs.writeFileSync(f.replace(/\.txt$/,'.trim.txt'),lines.slice(i+1).join('\n'));
}
console.log('trimmed');
