// Re-render only the chosen region. PDF coordinates survive zoom, rotation and scrolling.
export async function capturePdfRegion(context,{page:pageNumber,rect,rotation}){
  const page=await context.pdf.getPage(pageNumber),base=page.getViewport({scale:1,rotation});
  const corners=[...base.convertToViewportPoint(rect[0],rect[1]),...base.convertToViewportPoint(rect[2],rect[3])],left=Math.max(0,Math.min(corners[0],corners[2])),top=Math.max(0,Math.min(corners[1],corners[3]));
  const width=Math.min(base.width,Math.max(corners[0],corners[2]))-left,height=Math.min(base.height,Math.max(corners[1],corners[3]))-top;
  if(width<4||height<4)throw new Error('Vùng chọn quá nhỏ. Hãy kéo chọn trọn hình hoặc bảng.');
  const scale=Math.min(2.5,3072/width,3072/height,Math.sqrt(6e6/(width*height))),viewport=page.getViewport({scale,rotation});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
  const ctx=canvas.getContext('2d',{alpha:false});
  try{
    await page.render({canvasContext:ctx,viewport,transform:[1,0,0,1,-left*scale,-top*scale],background:'#ffffff',annotationMode:0}).promise;
    let url=canvas.toDataURL('image/png');if(url.length>2*1024*1024*4/3)url=canvas.toDataURL('image/jpeg',.88);
    const labels=await context.pdf.getPageLabels().catch(()=>null);
    const content=await page.getTextContent().catch(()=>({items:[]}));
    const bounds=[Math.min(rect[0],rect[2]),Math.min(rect[1],rect[3]),Math.max(rect[0],rect[2]),Math.max(rect[1],rect[3])];
    const text=content.items.filter(item=>{
      const x=item.transform?.[4],y=item.transform?.[5],h=Math.max(1,item.height||Math.abs(item.transform?.[3])||10);
      return item.str&&x+Math.max(item.width,1)>bounds[0]&&x<bounds[2]&&y+h>bounds[1]&&y<bounds[3];
    }).map(item=>item.str+(item.hasEOL?'\n':' ')).join('').slice(0,7500);
    return {mimeType:url.slice(5,url.indexOf(';')),data:url.slice(url.indexOf(',')+1),name:`${context.info.name} · Trang ${pageNumber}`,origin:{token:context.info.token,page:pageNumber,label:labels?.[pageNumber-1]||null,owner:context.owner,rects:[{page:pageNumber,rect:[...rect]}],text:'Ảnh vùng PDF được người dùng chọn.'+(text?'\nLớp văn bản trong vùng (có thể chưa đúng thứ tự bảng):\n'+text:'\nVùng này không có lớp văn bản; hãy đọc ảnh được cung cấp.')}};
  }finally{canvas.width=canvas.height=0;}
}
