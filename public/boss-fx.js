// Cells run left to right. Pivots are pixel coordinates inside each cell.
const sheets={
  boss_freeza_charge:{cell:[48,48],frames:4,ms:80,pivot:[24,24],width:11},
  boss_freeza_shot:{cell:[64,32],frames:4,ms:50,pivot:[50,16],width:16,loop:true},
  boss_freeza_impact:{cell:[64,64],frames:5,ms:50,pivot:[32,32],width:15},
  boss_arlong_charge:{cell:[48,48],frames:4,ms:60,pivot:[24,24],width:11},
  boss_arlong_dash:{cell:[72,48],frames:4,ms:55,pivot:[51,24],width:24,loop:true},
  boss_arlong_impact:{cell:[64,64],frames:5,ms:55,pivot:[32,32],width:17},
  boss_gaara_charge:{cell:[64,64],frames:6,ms:120,pivot:[32,32],width:13},
  boss_gaara_field:{cell:[112,112],frames:6,ms:120,pivot:[56,56],rim:51},
  boss_gaara_burst:{cell:[112,112],frames:6,ms:55,pivot:[56,56],rim:51},
  boss_gaara_impact:{cell:[64,64],frames:5,ms:50,pivot:[32,32],width:12},
  boss_byakuya_charge:{cell:[64,64],frames:5,ms:90,pivot:[32,32],width:13},
  boss_byakuya_shot:{cell:[48,48],frames:4,ms:60,pivot:[38,24],width:14,loop:true},
  boss_byakuya_impact:{cell:[64,64],frames:5,ms:50,pivot:[32,32],width:14}
};

const images=new Map();
const loadedKinds=new Set();
function bossImage(art){
  if(!images.has(art)){
    const image=new Image();
    image.src='./art/arena-bosses/'+art+'.png';
    images.set(art,image);
  }
  return images.get(art);
}

function drawSheet(ctx,art,x,y,age,motion,angle=0,radius){
  const {cell:[w,h],frames,ms,pivot:[px,py],width,rim,loop}=sheets[art];
  const elapsed=Math.floor(age*1000/ms);
  if(elapsed<0||(!loop&&elapsed>=frames))return;
  const image=bossImage(art);
  if(!image.complete||!image.naturalWidth)return;
  const frame=motion?elapsed%frames:Math.floor((frames-1)/2);
  const scale=rim?radius/rim:width/w;
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(angle);
  ctx.drawImage(image,frame*w,0,w,h,-px*scale,-py*scale,w*scale,h*scale);
  ctx.restore();
}

export function paintBossEffects(ctx,match,motion,finishAge=0){
  if(!match.result){
    for(const {team,slot} of match.sides){
      const kind=team[slot]?.kind;
      if(!sheets[kind+'_charge']||loadedKinds.has(kind))continue;
      for(const key of Object.keys(sheets))if(key.startsWith(kind+'_'))bossImage(key);
      loadedKinds.add(kind);
    }
    for(const {f,born,zone,index} of match.bossMoves??[]){
      if(index!==0)continue;
      const origin=match.sides[f.side],target=match.sides[1-f.side],age=match.t-born;
      const directional=f.kind==='boss_freeza'||f.kind==='boss_arlong';
      const angle=directional?Math.atan2(target.y-origin.y,target.x-origin.x):0;
      const offset=f.kind==='boss_freeza'?5.6:f.kind==='boss_arlong'?3.8:0;
      drawSheet(ctx,f.kind+'_charge',origin.x+offset*Math.cos(angle),origin.y+offset*Math.sin(angle),age,motion,angle);
      if(zone)drawSheet(ctx,'boss_gaara_field',zone.x,zone.y,age,motion,0,zone.radius);
    }
    for(const side of match.sides){
      const dash=side.dash;
      if(dash?.art==='boss_arlong_dash')
        drawSheet(ctx,dash.art,side.x,side.y,match.t-dash.born,motion,dash.angle);
    }
    for(const shot of match.shots){
      if(shot.kind==='bossShot')drawSheet(ctx,shot.f.kind+'_shot',shot.x,shot.y,match.t-shot.born,motion,shot.angle);
    }
  }
  for(const fx of match.bossFx??[]){
    drawSheet(ctx,fx.art,fx.x,fx.y,match.t-fx.born+finishAge,motion,fx.angle,fx.radius);
  }
}
