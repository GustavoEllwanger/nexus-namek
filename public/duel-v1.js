import {Combate} from "./engine.js";

// Fixed-step simulation in a 100 × 50 arena.
const DT=1/60;
export function collisionBonus(hits){return Math.min(40,12*hits);}

function rawCollision(f){
  return (f.magicBasic?f.magic:f.attack)*(1+collisionBonus(f.hits)/100);
}
export function collisionPower(m,f){
  return m.combat.outgoingPower(f,rawCollision(f),true);
}
export function createDuel(left,right,limit=120){
  const combat=new Combate([left,right]);
  const sides=combat.teams.map((team,i)=>({
    team:team.map((f,slot)=>Object.assign(f,{hits:0,ready:2+slot*1.2})),
    slot:0,x:i?80:20,y:i?30:20,vx:i?-26:26,vy:i?-12:12
  }));
  return {combat,sides,limit,skills:[],t:0,result:null,events:[],damageFeed:[],contact:0,contacts:0};
}
function note(m,text){m.events.unshift(text);m.events.length=Math.min(5,m.events.length);}
function announce(m,f,name,role){
  const text=f.name+' · '+name+(role==='reserva'?' (assistência)':'');
  m.skills.unshift({side:f.side,slot:f.slot,name,role,text,time:m.t});
  m.skills.length=Math.min(m.skills.length,12);
  note(m,text);
}
export function finishDuel(match){
  while(match.result===null)stepDuel(match);
  return match;
}
function move(s,other,unit){
  const dx=other.x-s.x,dy=other.y-s.y,d=Math.max(1,Math.hypot(dx,dy));
  s.vx+=dx/d*52*DT;s.vy+=dy/d*52*DT;
  const speed=Math.min(48,26+unit.speed*.065),factor=speed/Math.max(.01,Math.hypot(s.vx,s.vy));
  s.vx*=factor;s.vy*=factor;
  s.x+=s.vx*DT;s.y+=s.vy*DT;
  if(s.x<4||s.x>96){s.vx*=-1;s.x=Math.max(4,Math.min(96,s.x));}
  if(s.y<4||s.y>46){s.vy*=-1;s.y=Math.max(4,Math.min(46,s.y));}
}
const passiveEvents={'aceleração':'Made in Heaven · Aceleração do Tempo','tempo parado':'The World','ressurge':'Ressurgimento'};
export function stepDuel(m){
  if(m.result!==null)return;
  m.t+=DT;
  const combat=m.combat;
  const firstEvent=combat.log.length;
  combat.time=Math.round(m.t*1000);
  const [a,b]=m.sides, active=m.sides.map(s=>s.team[s.slot]);
  const old={x:a.x,y:a.y};
  if(!combat.blocked(active[0]))move(a,b,active[0]);
  if(!combat.blocked(active[1]))move(b,old,active[1]);
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
  if(d<=8&&m.t>=m.contact){
    const nx=dx/(d||1),ny=dy/(d||1);
    const angle=Math.sin(m.t*2)*.52,c=Math.cos(angle),s=Math.sin(angle);
    b.vx=(nx*c-ny*s)*36;b.vy=(nx*s+ny*c)*36;a.vx=-b.vx;a.vy=-b.vy;
    // Alternate initiative on contact. A defeated or stunned fighter cannot counter.
    const order=m.contacts%2===1?[1,0]:[0,1];
    m.contacts++;
    for(const i of order){
      const f=active[i],g=active[1-i];
      if(!combat.present(f)||!combat.present(g)||combat.blocked(f))continue;
      f.actions++;
      if(combat.hit(f,g,{damage:rawCollision(f),skill:false,magic:!!f.magicBasic}))f.hits++;
    }
    note(m,'Colisão · '+active.map(f=>f.name).join(' × '));m.contact=m.t+.45;
  }
  m.sides.forEach((side,i)=>{
    const ally=active[i],enemy=active[1-i];
    for(const f of side.team.slice(side.slot)){
      if(f.ready>m.t||!combat.present(ally)||!combat.present(enemy)||combat.blocked(f))continue;
      const reserve=f!==ally;
      if(!reserve)combat.beginAttack(f);
      f.ready=m.t+(reserve?8:2)*combat.pace(f);
      if(reserve && f.role==='Suporte' && !f.signatureAssist){
        combat.heal(ally,Math.round(f.magic*.8));announce(m,f,'Cura de apoio','reserva');
      }else{
        const used=combat.use(f,enemy,f.kind,reserve?'reserva':'principal');
        if(!used&&!reserve&&combat.pace(f)<1)combat.hit(f,enemy,{skill:false,magic:f.magicBasic,damage:f.magicBasic?f.magic:f.attack});
      }
    }
  });
  m.sides.forEach((side,i)=>{
    if(!combat.alive(active[i])){
      side.slot++;
      if(side.slot<side.team.length){
        side.x=i?80:20;side.y=i?30:20;side.vx=i?-26:26;side.vy=i?-12:12;
        side.team[side.slot].ready=m.t+2;
        note(m,side.team[side.slot].name+' entra na arena.');
      }
    }
  });
  for(let i=firstEvent;i<combat.log.length;i++){
    const e=combat.log[i];
    if(e.type==='especial'){
      const [side,slot]=e.actor.split(':').map(Number);
      announce(m,m.sides[side].team[slot],e.name,e.role);
    }
    if(passiveEvents[e.type] && e.actor){
      const [side,slot]=e.actor.split(':').map(Number);
      const actor=m.sides[side].team[slot];
      const combo=e.type==='aceleração'&&actor.nen?' · Última Aposta 8×':'';
      announce(m,actor,passiveEvents[e.type]+combo,'passiva');
    }
    if(e.type!=='dano'||e.hp<=0)continue;
    const [side,slot]=e.actor.split(':').map(Number);
    const [other,targetSlot]=e.target.split(':').map(Number);
    m.damageFeed.unshift({seq:i,side,source:m.sides[side].team[slot].name,target:m.sides[other].team[targetSlot].name,amount:e.hp});
  }
  if(m.damageFeed.length>12)m.damageFeed.length=12;
  const out=m.sides.map(s=>s.slot===s.team.length);
  if(out.some(Boolean))m.result=out[0]===out[1]?'Empate':out[0]?'Derrota':'Vitória';
  else if(m.t+1e-8>=m.limit){
    const score=m.sides.map(s=>s.team.reduce((n,f)=>n+f.hp/f.maxHp,0)/s.team.length);
    m.result= Math.abs(score[0]-score[1])<.00001?'Empate':score[0]>score[1]?'Vitória':'Derrota';
    note(m,'Tempo esgotado · decisão pela média das frações de PV restantes.');
  }
}
