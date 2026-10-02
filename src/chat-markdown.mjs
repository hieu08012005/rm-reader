// Build Markdown with DOM nodes only: model/PDF HTML, links and scripts are never executed.
export function renderAnswer(container,text,sources,onSource){
  container.replaceChildren();const byId=new Map((sources||[]).map(s=>[s.id,s]));
  const inline=(node,value)=>{
    const pattern=/\[\s*SRC\s*:\s*([\w-]+)\s*\]|`([^`\n]+)`|\*\*([^*]+)\*\*/gi;let last=0,match;
    while((match=pattern.exec(value))){node.append(document.createTextNode(value.slice(last,match.index)));let part;
      if(match[1]){const source=byId.get(match[1]);part=document.createElement(source?'button':'span');part.className=source?'chat-citation':'chat-invalid-citation';part.textContent=source?`[${source.documentName} · Trang ${source.page}${source.label&&source.label!==String(source.page)?' · Nhãn '+source.label:''}]`:'[Nguồn chưa được cung cấp]';if(source){part.title=source.text.slice(0,600);part.onclick=()=>onSource(source);}}
      else{part=document.createElement(match[2]?'code':'strong');part.textContent=match[2]||match[3];}node.append(part);last=pattern.lastIndex;
    }node.append(document.createTextNode(value.slice(last)));
  };
  const lines=text.split('\n');let i=0;
  while(i<lines.length){const line=lines[i];
    if(line.startsWith('```')){const language=line.slice(3).trim();const code=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i++]);if(i<lines.length)i++;
      const wrap=document.createElement('div');wrap.className='chat-code';const header=document.createElement('div');header.textContent=language||'Mã';const copy=document.createElement('button');copy.textContent='Sao chép mã';copy.onclick=()=>navigator.clipboard.writeText(code.join('\n')).then(()=>{copy.textContent='Đã sao chép';}).catch(()=>{copy.textContent='Không sao chép được';});header.append(copy);const pre=document.createElement('pre'),content=document.createElement('code');content.textContent=code.join('\n');pre.append(content);wrap.append(header,pre);container.append(wrap);continue;
    }
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      const wrap=document.createElement('div');wrap.className='chat-table';const table=document.createElement('table');const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|');const add=(row,tag)=>{const tr=document.createElement('tr');for(const cell of cells(row)){const td=document.createElement(tag);inline(td,cell.trim());tr.append(td);}table.append(tr);};add(line,'th');i+=2;while(i<lines.length&&lines[i].includes('|'))add(lines[i++],'td');wrap.append(table);container.append(wrap);continue;
    }
    if(/^\s*(?:[-*•]|\d+\.)\s+/.test(line)){const list=document.createElement(/^\s*\d+\./.test(line)?'ol':'ul');while(i<lines.length&&/^\s*(?:[-*•]|\d+\.)\s+/.test(lines[i])){const item=document.createElement('li');inline(item,lines[i++].replace(/^\s*(?:[-*•]|\d+\.)\s+/,''));list.append(item);}container.append(list);continue;}
    if(!line.trim()){i++;continue;}const heading=/^(#{1,4})\s+(.+)/.exec(line);const p=document.createElement(heading?'h4':'p');inline(p,heading?heading[2]:line);container.append(p);i++;
  }
}
