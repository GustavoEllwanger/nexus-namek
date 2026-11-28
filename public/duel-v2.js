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
  return {combat,sides,limit,skills:[],shots:[],flashes:[],t:0,result:null,events:[],damageFeed:[],contact:0,contacts:0};
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
const R=4, ROOM=18;
function move(s,unit){
  const speed=Math.min(48,26+unit.speed*.065);
  const factor=speed/(Math.hypot(s.vx,s.vy)||1);
  s.vx*=factor;s.vy*=factor;
  s.x+=s.vx*DT;s.y+=s.vy*DT;
  // Reflect the overshoot so distance is conserved at walls and corners.
  if(s.x<R||s.x>100-R){s.x=2*(s.x<R?R:100-R)-s.x;s.vx*=-1;}
  if(s.y<R||s.y>50-R){s.y=2*(s.y<R?R:50-R)-s.y;s.vy*=-1;}
}
const areaSkills=new Set(['dominio','despertar','nichirin','freeza-boss','ginyu']);
const meleeSkills=new Set(['furia','instinto','bodisatva','shunko','excalibur','rush','yamcha','reescrita','benihime']);
function arenaCast(m,f,enemy,role){
  const origin=m.sides[f.side],other=m.sides[1-f.side];
  let shot;
  const launch=(target,attack)=>{
    if(!shot){
      const kind=f.kind==='room'?'room':areaSkills.has(f.kind)?'zone':meleeSkills.has(f.kind)?'blade':'bolt';
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x);
      shot={kind,f,side:f.side,x:origin.x,y:origin.y,angle,born:m.t,attacks:[],
        radius:kind==='room'?ROOM:kind==='zone'?23:kind==='blade'?3:2,
        range:kind==='blade'?25:110,speed:kind==='blade'?90:78};
      m.shots.push(shot);
    }
    shot.attacks.push(attack);
    return true;
  };
  const used=m.combat.use(f,enemy,f.kind,role,launch);
  if(!used&&role==='principal'&&m.combat.pace(f)<1){
    // Accelerated basic attacks also need a spatial hit.
    launch(enemy,{skill:false,magic:f.magicBasic,damage:f.magicBasic?f.magic:f.attack});
    shot.kind=f.magicBasic?'bolt':'blade';shot.radius=f.magicBasic?2:3;
    shot.speed=f.magicBasic?78:90;shot.range=f.magicBasic?110:25;shot.basic=true;
  }
}
function traceHit(x,y,dx,dy,radius){
  const len=dx*dx+dy*dy;
  const u=len?Math.max(0,Math.min(1,-(x*dx+y*dy)/len)):0;
  return Math.hypot(x+u*dx,y+u*dy)<=radius;
}
function resolveShots(m,previous){
  m.flashes=m.flashes.filter(e=>m.t-e.time<.23);
  m.shots=m.shots.filter(s=>{
    const caster=m.sides[s.side],other=m.sides[1-s.side],victim=other.team[other.slot];
    if(!m.combat.alive(s.f)||!victim||!m.combat.present(victim))return false;
    const age=m.t-s.born,zone=s.kind==='room'||s.kind==='zone';
    let hit=false;
    if(zone){
      // Activate after the ring has opened. ROOM remains armed for one cut.
      if(age<.3)return true;
      hit=Math.hypot(other.x-s.x,other.y-s.y)<=s.radius+R;
      if(!hit && age<(s.kind==='room'?1.5:.45))return true;
    }else{
      const [ox,oy]=previous[1-s.side],vx=Math.cos(s.angle)*s.speed*DT,vy=Math.sin(s.angle)*s.speed*DT;
      hit=traceHit(s.x-ox,s.y-oy,vx-(other.x-ox),vy-(other.y-oy),s.radius+R);
      s.x+=vx;s.y+=vy;
      if(!hit&&age*s.speed<s.range&&s.x>=0&&s.x<=100&&s.y>=0&&s.y<=50)return true;
    }
    if(!hit){note(m,(s.basic?'Ataque básico':s.f.skill)+' · errou');return false;}
    m.flashes.push({kind:s.kind,side:s.side,x:other.x,y:other.y,fromX:caster.x,fromY:caster.y,time:m.t});
    for(const attack of s.attacks){
      if(!m.combat.alive(s.f)||!m.combat.present(victim))break;
      if(!s.basic&&s.f.kind==='ashisogi')victim.weakenUntil=Math.max(victim.weakenUntil,m.combat.time+4000);
      m.combat.hit(s.f,victim,attack);
      if(!s.basic&&s.f.kind==='dominio')victim.stunUntil=Math.max(victim.stunUntil??0,m.combat.time+1500);
    }
    return false;
  });
}
const passiveEvents={'aceleração':'Made in Heaven · Aceleração do Tempo','tempo parado':'The World','ressurge':'Ressurgimento'};
export function stepDuel(m){
  if(m.result!==null)return;
  m.t+=DT;
  const combat=m.combat;
  const firstEvent=combat.log.length;
  combat.time=Math.round(m.t*1000);
  const [a,b]=m.sides, active=m.sides.map(s=>s.team[s.slot]);
  const previous=m.sides.map(s=>[s.x,s.y]);
  if(!combat.blocked(active[0]))move(a,active[0]);
  if(!combat.blocked(active[1]))move(b,active[1]);
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
  if(d<=2*R){
    const nx=d?dx/d:1,ny=d?dy/d:0,push=(2*R-d)/2;
    a.x=Math.max(R,Math.min(100-R,a.x-nx*push));a.y=Math.max(R,Math.min(50-R,a.y-ny*push));
    b.x=Math.max(R,Math.min(100-R,b.x+nx*push));b.y=Math.max(R,Math.min(50-R,b.y+ny*push));
    const closing=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
    if(closing>0){a.vx-=closing*nx;a.vy-=closing*ny;b.vx+=closing*nx;b.vy+=closing*ny;}
  }
  if(d<=2*R&&m.t>=m.contact){
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
  resolveShots(m,previous);
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
        arenaCast(m,f,enemy,reserve?'reserva':'principal');

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
