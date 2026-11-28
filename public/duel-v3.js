function hasTrait(unit,name){return unit.traits?.includes(name)||unit.trait===name;}
const DEFAULT_LIMIT = 60000;
const SAMPLE_STEP = 100;
const HP_EPSILON = 1e-8;
const sum = values => values.reduce((a, b) => a + b, 0);
const COLORS = ['Vermelho','Laranja','Amarelo','Verde','Turquesa','Azul','Roxo','Rosa'];
function affinity(a, b) {
  if (!a || !b) return 1;
  if (a === 'Dourado') return b === a ? 2 : 1.5;
  if ((a === 'Branco' || a === 'Preto') && a === b) return 1.5;
  const position = COLORS.indexOf(a);
  if (position < 0) return 1;
  return b === COLORS[(position + 1) % 8] ? 1.5 : b === COLORS[(position + 7) % 8] ? .75 : 1;
}
const distance = (a, b) => Math.hypot((a.x ?? a.slot * 20) - (b.x ?? b.slot * 20), (a.y ?? 50) - (b.y ?? 50));
const MAIN_SKILLS = new Set(['piccolo','yamcha','kuririn','bulma','freeza-boss','ginyu','beam','rush','ward','heal']);

class Combate {
  constructor(rosters, { mode = 'duelo', limit = DEFAULT_LIMIT } = {}) {
    if (!['duelo', 'equipe'].includes(mode) || !Number.isInteger(limit) || limit < SAMPLE_STEP || limit > DEFAULT_LIMIT || rosters.length !== 2 || rosters.some(team => !team.length || team.length > 4)) {
      throw new RangeError('Configuração de combate inválida.');
    }
    this.mode = mode;
    this.limit = limit;
    this.time = 0;
    this.teams = rosters.map((team, side) => team.map((spec, slot) => ({
      ...spec, side, slot, id: `${side}:${slot}`, name: spec.name ?? `${side}:${slot}`,
      hp: spec.hp ?? 1000, maxHp: spec.hp ?? 1000, attack: spec.attack ?? 100, magic: spec.magic ?? 100,
      defense: spec.defense ?? 0, resistance: spec.resistance ?? 0, shield: spec.shield ?? 0,
      interval: Math.max(SAMPLE_STEP, spec.interval ?? 3000), nextBasic: Math.max(SAMPLE_STEP, spec.interval ?? 3000),
      nextAssist: 5000, evade: spec.evade ?? 0, intercept: spec.intercept ?? 0, survive: spec.survive ?? 0, protectUntil: spec.intercept ? Infinity : 0,
      revive: spec.revive ?? 0, vector: spec.kind === 'accelerator' ? 2 : 0, vectorReady: 0,
      uses: 0, skillReady: 0, actions: 0, seenId: null, seenActions: 0, graceUntil: 0,
      weakenUntil: 0, powerUntil: 0, resistedUntil: 0,
    })));
    this.log = [];
    this.hasteUntil=[0,0];
    for(const team of this.teams){
      const king=team.find(u=>hasTrait(u,'Haki do Rei'));
      if(king)for(const foe of this.teams[1-king.side]){
        applyNegative(foe,'stunUntil',2000);applyNegative(foe,'exposedUntil',2000);
      }
    }
  }

  record(type, actor, target, data = {}) {
    this.log.push({ time: this.time, type, actor: actor?.id, target: target?.id, ...data });
  }

  alive(u) { return u.hp > HP_EPSILON; }
  active(side) { return this.teams[side].find(u => this.alive(u)); }
  present(u) { return this.alive(u) && (this.mode === 'equipe' || this.active(u.side) === u); }

  blocked(u){return u.stunUntil>this.time||(this.freezeUntil>this.time&&this.freezeOwner!==u);}
  pace(u){
    if(u.hasteUntil>this.time)return .2;
    return this.hasteUntil[u.side]>this.time?.6:1;
  }
  beginAttack(u){
    if(!hasTrait(u,'Made in Heaven')||u.heavenUsed)return;
    const team=this.teams[u.side],before=team.map(f=>this.pace(f));
    u.heavenUsed=true;u.hasteUntil=this.time+5000;this.hasteUntil[u.side]=this.time+5000;
    team.forEach((f,i)=>{
      const ratio=this.pace(f)/before[i];
      if(f.nextBasic>this.time)f.nextBasic=this.time+(f.nextBasic-this.time)*ratio;
      if(f.ready>this.time/1000)f.ready=this.time/1000+(f.ready-this.time/1000)*ratio;
    });
    this.record('aceleração',u);
  }
  outgoingPower(source,damage,basic=false){
    const trait=Math.max(1,(hasTrait(source,'Made in Heaven')?4:0)+(source.nen?4:0));
    return damage*trait*(basic&&source.weakenUntil>this.time?.65:1);
  }

  hit(source, target, attack = {}) {
    const { damage = source.attack, magic = false, skill = true, area = false, reflected = false,
      removeShield = false, shieldMultiplier = 1, ignoreDefense = 0, blockRevive = false, delayOnBreak = 0 } = attack;
    if (!this.alive(source) || !this.present(target) || source.side === target.side) return false;
    if (!Number.isFinite(damage) || damage < 0 || !Number.isFinite(shieldMultiplier) || shieldMultiplier < 1) throw new RangeError('Dano ou multiplicador inválido.');
    if(!reflected)this.beginAttack(source);
    let victim = target,interceptFactor=1;
    if(!area&&!reflected){
      const guard=this.teams[target.side].find(u=>u!==target&&hasTrait(u,'Restrição Celestial')&&!this.blocked(u)&&this.alive(u)&&(u.guardUses??0)<2&&(this.mode==='duelo'||distance(u,target)<=30));
      if(guard){guard.guardUses=(guard.guardUses??0)+1;victim=guard;interceptFactor=.5;this.record('intercepta',guard,target);}
    }
    if (victim===target && !area && !reflected && this.mode === 'equipe') {
      const guard = this.teams[target.side].find(u => u !== target && !this.blocked(u) && this.alive(u) && u.intercept > 0 && u.protectUntil >= this.time && distance(u,target) <= 30);
      if (guard) {
        guard.intercept--;
        victim = guard;
        this.record('intercepta', guard, target);
      }
    }
    if(!area && victim.portalDodge){
      victim.portalDodge=false;this.record('portal',victim,source);return false;
    }
    if(!area && victim.kind==='dominio' && !victim.infinityUsed){
      victim.infinityUsed=true;this.record('ilimitado',victim,source);return false;
    }
    if(!area && victim.kind==='instinto' && victim.stanceUntil>this.time){
      this.record('instintiva',victim,source);return false;
    }
    if (!area && !reflected && victim.evade > 0) {
      victim.evade--;
      this.record('esquiva', victim, source);
      if(hasTrait(victim,'Instinto Superior')&&!attack.counter&&!this.blocked(victim)&&this.present(source))this.hit(victim,source,{skill:false,counter:true,magic:!!victim.magicBasic,damage:victim.magicBasic?victim.magic:victim.attack});
      return true;
    }
    if(!area&&!reflected&&skill&&hasTrait(victim,'Haki da Observação')&&(victim.observeUses??0)<2&&!this.blocked(victim)&&this.present(source)){
      victim.observeUses=(victim.observeUses??0)+1;
      this.hit(victim,source,{skill:false,counter:true,damage:2*(victim.magicBasic?victim.magic:victim.attack),magic:!!victim.magicBasic});
      if(!this.alive(source))return true;
    }
    if (!area && !reflected && skill) {
      const mirror=magic&&this.teams[victim.side].find(u=>hasTrait(u,'Full Counter')&&!u.mirrorUsed&&this.alive(u)&&!this.blocked(u)&&(u===victim||this.mode==='duelo'||distance(u,victim)<=30));
      if(mirror){
        mirror.mirrorUsed=true;this.record('reflete',mirror,source);
        this.hit(mirror,this.present(source)?source:this.active(source.side),{...attack,damage:damage*2,reflected:true});
        return true;
      }
      const vector = this.teams[victim.side].find(u => this.alive(u) && u.vector > 0 && u.vectorReady <= this.time && (this.mode === 'duelo' || Math.abs(u.slot - victim.slot) <= 1));
      if (vector) {
        vector.vector--;
        vector.vectorReady = this.time + 8000;
        this.record('especial',vector,source,{name:vector.skill??'Controle Vetorial',role:'reação'});
        this.record('reflete', vector, source, { remaining: vector.vector });
        const returnTarget = this.present(source) ? source : this.active(source.side);
        if (returnTarget) this.hit(vector, returnTarget, { ...attack, damage, reflected: true });
        return true;
      }
    }
    const openPower = skill && !reflected && source.powerUntil > this.time;
    if (openPower) source.powerUntil = 0;
    const mitigation = (magic ? victim.resistance : victim.defense) * (1 - ignoreDefense);
    let value = this.outgoingPower(source,damage,!skill) * interceptFactor * (victim.exposedUntil>this.time?1.3:1) * affinity(source.color,victim.color) * (openPower ? 1.3 : 1) * 40 / (40 + mitigation/(source.scale || 1));
    const element=magic?'magico':'fisico';
    source.lastDamageType=element;
    if(victim.kind==='meruem_rei'){
      const learned=victim.learned??=new Set();
      if(learned.has(element))value*=.72;
      else learned.add(element);
      this.record('carapaca',victim,source);
    }
    if(victim.adaptiveUntil>this.time&&victim.adaptiveType===element)value*=.72;
    if(magic&&skill&&victim.moonGuard){
      victim.moonGuard=false;this.record('lunar',victim,source);return false;
    }
    if(magic && victim.moonShield>0){
      const spent=Math.min(victim.moonShield,value);victim.moonShield-=spent;value-=spent;
      this.record('lunar',victim,source);
    }
    if(source.kotoUntil>this.time && (skill || true)){
      source.kotoUntil=0;
      value*=.60;
    }
    if(attack.koto)victim.kotoUntil=this.time+4000;
    if(victim.fictionUntil>this.time){
      value-=Math.min(value,victim.fictionWard);
      victim.fictionUntil=0;
      this.record('apaga',victim,source);
    }
    const available=removeShield||attack.pierceFirst?0:victim.shield/shieldMultiplier;
    if(skill && value-available>=victim.hp && (victim.zeroGuard||this.active(victim.side)?.kind==='giorno') && !this.zeroUsed?.[victim.side]){
      const main=this.active(victim.side)?.kind==='giorno';
      (this.zeroUsed??={})[victim.side]=true;victim.zeroGuard=false;
      if(main){this.heal(victim,victim.maxHp*.25);source.loseAction=true}
      this.record('zero',victim,source,{main});return false;
    }
    const priorShield = victim.shield;
    if (removeShield) victim.shield = 0;
    const absorbed = attack.pierceFirst ? 0 : Math.min(victim.shield, value * shieldMultiplier);
    victim.shield -= absorbed;
    value -= absorbed / shieldMultiplier;
    if (priorShield > 0 && victim.shield <= HP_EPSILON) {
      victim.shield = 0;
      victim.nextBasic += delayOnBreak;
      this.record('escudo rompe', source, victim);
    }
    const actual = Math.min(victim.hp, value);
    victim.hp = Math.max(0, victim.hp - value);
    if(actual>0){
      if(skill&&!attack.reflected){
        const key=dotKinds[source.characterId];
        if(key)applyDot({t:this.time/1000},source,victim,key,Math.min(victim.maxHp*.025,Math.max(source.attack,source.magic)*.2),.6,5);
      }
      if(victim.kind==='meliodas_v')victim.demonCharge=(victim.demonCharge??0)+actual;
      victim.recentImpact=(victim.recentImpact??[]).filter(e=>this.time-e.t<=4000);
      victim.recentImpact.push({t:this.time,n:actual});
      if(attack.crack)applyNegative(victim,'crackedShield',true);
    }
    this.record('dano', source, victim, { hp: actual, reflected, remaining: victim.hp, skill });
    if(!this.alive(victim)&&victim.timeMark?.until>this.time){
      const mark=victim.timeMark;victim.timeMark=null;victim.hp=mark.hp;
      if(mark.main){victim.skillReady=this.time;victim.ready=this.time/1000;mark.owner.timeSpent=true}
      this.record('reverte',victim,source);return true;
    }
    if(!this.alive(victim)){
      const main=!!(victim.kind==='yhwach'&&!victim.almightySpent);
      if(main||victim.futureUntil>this.time){
        victim.futureUntil=0;victim.hp=victim.maxHp*(main?.35:.20);
        if(main){victim.almightySpent=true;victim.skillReady=this.time;victim.ready=this.time/1000}
        this.record('futuro',victim,source);return true;
      }
      const madoka=this.teams[victim.side].find(u=>u.kind==='madoka' && (u===victim||this.present(u)));
      if(!blockRevive && madoka && !madoka.cycleSpent && negativeKeys(victim,this.time).length){
        madoka.cycleSpent=true;cleanse(victim,this.time,false);victim.hp=victim.maxHp*.35;
        this.record('ciclos',victim,source);return true;
      }
    }
    if (!this.alive(victim)) this.defeat(victim, source, blockRevive);
    return true;
  }

  defeat(victim, source, blockRevive) {
    if (victim.survive > 0) {
      victim.survive--;
      if(hasTrait(victim,"Zenkai")){victim.attack*=1.75;victim.magic*=1.75;}
      victim.hp = victim.maxHp * .4;
      this.record('sobrevive', victim, source, { remaining: victim.hp });
    } else if (victim.revive > 0 && !blockRevive) {
      victim.revive--;
      victim.hp = victim.maxHp * .7;
      this.record('ressurge', victim, source, { remaining: victim.hp });
    } else {
      victim.hp = 0;
      victim.shield = 0;
      const successor = this.mode === 'duelo' ? this.active(victim.side) : null;
      this.record('cai', victim, source);
      if(source?.kind==='rei'&&!source.kingAdvance){
        source.kingAdvance=true;
        source.skillReady=Math.max(this.time,source.skillReady-3000);
        source.ready=Math.min(source.ready,source.skillReady/1000);
      }
      if (successor) {
        successor.nextBasic = this.time + successor.interval;
        successor.graceUntil = this.time + SAMPLE_STEP;
        this.record('entra', successor);
      }
    }
  }

  heal(unit, amount) {
    if (!this.alive(unit)) return;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    this.record('cura', unit, undefined, { remaining: unit.hp });
  }

  use(actor,target,type,role='principal',launch){
    const used=this.cast(actor,target,type,role,launch);
    if(used&&actor.skill)this.record('especial',actor,target,{name:actor.skill,role});
    if(used&&role==='principal'&&hasTrait(actor,'The World')&&!actor.worldUsed){
      actor.worldUsed=true;this.freezeOwner=actor;this.freezeUntil=this.time+3000;
      actor.skillReady=0;actor.nextBasic=Math.min(actor.nextBasic,this.time+SAMPLE_STEP);
      actor.ready=this.time/1000;this.record('tempo parado',actor);
    }
    return used;
  }
  cast(actor, target, type, role = 'principal', launch) {
    if (!this.alive(actor) || !this.present(target)) return false;
    const deliver = launch ?? ((victim,options)=>this.hit(actor,victim,options));
    const strike = options => deliver(target,options);
    if(role==='reserva'){
      const active=this.active(actor.side);
      if(type==='reescrita'){
        if(!active||active.hp>active.maxHp*.4)return false;
        this.heal(active,active.maxHp*.30);return true;
      }
      if(type==='kaguya'){
        if(!active||active.portalDodge)return false;
        active.portalDodge=true;return true;
      }
      if(type==='tremor')return strike({area:true,damage:actor.attack*1.35,removeShield:true,delayOnBreak:1000});
    }
    switch (type) {
      case 'rei':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack,magic:false,pierceFirst:true});
      case 'koto':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({magic:true,koto:true,damage:actor.magic*1.75});
      case 'demonSword':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        strike({damage:actor.attack*.7,bladeIndex:0});
        return strike({damage:actor.attack*.7,bladeIndex:1});
      case 'fiction': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        const ally=this.active(actor.side);
        ally.fictionUntil=this.time+4000;ally.fictionWard=actor.magic*1.8;
        this.record('protege',actor,ally);
        return strike({magic:true,damage:actor.magic*1.3});
      }
      case 'room':
      case 'benihime': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        const ally=this.teams[actor.side].filter(u=>this.present(u))
          .reduce((lowest,u)=>u.hp/u.maxHp<lowest.hp/lowest.maxHp?u:lowest);
        if(type==='room'){
          this.heal(ally,1.5*actor.magic);
          return strike({magic:true,damage:1.35*actor.magic,ignoreDefense:.4});
        }
        grantShield(ally,2.2*actor.magic);
        this.record('protege',actor,ally);
        return strike({magic:true,damage:1.05*actor.magic});
      }
      case 'barreira':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        for(const ally of this.teams[actor.side].filter(u=>this.present(u))){
          grantShield(ally,actor.defense*(ally===actor?1.8:1));
          this.record('protege',actor,ally);
        }
        return true;
      case 'death_ray':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        return strike({magic:true,damage:actor.magic*(target.hp<target.maxHp*.35?2.35:1.75),ignoreDefense:.25});
      case 'final_flash':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack*2.15,shieldMultiplier:2});
      case 'furia':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+6000;
        return strike({damage:actor.attack*(1.65+.25*Math.min(actor.uses++,3))});
      case 'santuario':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        return strike({area:true,magic:true,damage:actor.magic*.45,shieldMultiplier:2});
      case 'instinto':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;actor.stanceUntil=this.time+2000;
        return true;
      case 'bodisatva': {
        if(actor.skillReady>this.time)return false;
        const instinct=type==='instinto';
        actor.skillReady=this.time+(instinct?8000:7000);
        if(instinct)actor.evade=Math.max(actor.evade,1);
        for(let i=0;i<(instinct?2:3)&&this.alive(actor)&&this.present(target);i++)
          strike({damage:actor.attack*(instinct?1:.65),ignoreDefense:i===2?.5:0});
        return true;
      }
      case 'dominio':
      case 'despertar': {
        if(actor.skillReady>this.time)return false;
        const domain=type==='dominio';
        actor.skillReady=this.time+(domain?12000:9000);
        const damage=actor.magic*(domain?1.55:actor.hp<=actor.maxHp*.5?2.25:1.65);
        for(const foe of this.teams[target.side].filter(u=>this.present(u))){
          deliver(foe,{magic:true,area:true,damage});
          if(domain&&!launch)applyNegative(foe,'stunUntil',Math.max(foe.stunUntil??0,this.time+1500));
        }
        return true;
      }
      case 'reescrita':
      case 'ciclo_vital': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        const ally=this.teams[actor.side].filter(unit=>this.present(unit))
          .reduce((lowest,unit)=>unit.hp/unit.maxHp<lowest.hp/lowest.maxHp?unit:lowest);
        if(type==='ciclo_vital'){
          this.heal(ally,actor.magic*2);
          return strike({damage:actor.magic*1.05,magic:true});
        }
        if(actor.uses===0&&ally.hp<=ally.maxHp*.4){
          actor.uses++;
          this.heal(ally,ally.maxHp*.5);
          return true;
        }
        return strike({damage:actor.attack*1.9});
      }
      case 'nichirin': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        const victims=this.teams[target.side].filter(unit=>this.present(unit)&&distance(unit,target)<=28);
        this.record('onda',actor,target,{targets:victims.map(unit=>unit.id)});
        for(const unit of victims)deliver(unit,{damage:actor.attack*(unit===target?1.8:.85),area:true});
        return true;
      }
      case 'tempestade': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        const other=this.teams[target.side].find(unit=>unit!==target&&this.present(unit));
        strike({damage:actor.magic*1.85,magic:true,ignoreDefense:.3});
        if(other)deliver(other,{damage:actor.magic*.75,magic:true});
        return true;
      }
      case 'ashisogi':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        if(!launch)applyNegative(target,'weakenUntil',Math.max(target.weakenUntil,this.time+4000));
        return strike({damage:actor.magic*1.3,magic:true});
      case 'metralleta':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        for(let i=0;i<3&&this.alive(actor)&&this.present(target);i++)strike({damage:actor.magic*.6,magic:true});
        return true;
      case 'shunko':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+12000;
        actor.evade++;
        return strike({damage:actor.attack*1.4});
      case 'excalibur':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        return strike({damage:actor.attack*1.45,ignoreDefense:.35});
      case 'piccolo':
      case 'ward': {
        if (actor.skillReady > this.time) return false;
        actor.skillReady = this.time + 10000;
        actor.intercept = 1;
        actor.protectUntil = this.time + 4500;
        grantShield(actor,actor.magic * 1.1);
        this.record('protege',actor);
        return true;
      }
      case 'bulma':
      case 'heal': {
        if (actor.skillReady > this.time) return false;
        const ally = this.teams[actor.side].filter(u=>this.present(u)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
        if (!ally || ally.hp/ally.maxHp > .95) return false;
        actor.skillReady = this.time + 7000;
        if (type === 'heal') this.heal(ally,actor.magic * 1.3);
        else { grantShield(ally,actor.magic*2);this.record('protege',actor,ally); }
        return true;
      }
      case 'yamcha':
      case 'kuririn':
      case 'rush':
      case 'beam': {
        if (actor.skillReady > this.time) return false;
        const magic = ['kuririn','beam'].includes(type);
        const victim = type === 'kuririn' ? this.teams[target.side].filter(u=>this.present(u)).sort((a,b)=>a.hp-b.hp)[0] : target;
        actor.skillReady = this.time + (magic ? 7000 : 6000);
        return deliver(victim,{ damage: magic ? actor.magic*1.65 : actor.attack*1.6, magic });
      }
      case 'freeza-boss':
      case 'ginyu': {
        if (actor.skillReady > this.time) return false;
        actor.skillReady = this.time + 12000;
        const anchor = this.teams[target.side].filter(u=>this.present(u)).sort((a,b)=>b.hp-a.hp)[0];
        const victims = this.teams[target.side].filter(u=>this.present(u)&&distance(u,anchor)<=28);
        this.record('onda',actor,anchor,{ targets: victims.map(u=>u.id) });
        for (const victim of victims) deliver(victim,{damage:actor.magic * (type === 'freeza-boss' ? .82 : .7),magic:true,area:true});
        return true;
      }
      case 'beerus': {
        if (role === 'principal' && actor.skillReady > this.time) return false;
        if (role === 'principal') actor.skillReady = this.time + 9000;
        return strike({ damage: actor.magic * (role === 'reserva' ? 1.25 : 2.4), magic: true, removeShield: true, blockRevive: role !== 'reserva' });
      }
      case 'zoro': return strike({ damage: actor.attack * 1.1, shieldMultiplier: 2 });
      case 'tremor':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack*1.35,area:true});
      case 'barba-branca': return strike({ damage: actor.attack * 1.35, removeShield: true, delayOnBreak: 1000 });
      case 'polnareff': {
        if (role === 'reserva') return strike({ damage: actor.attack, shieldMultiplier: 2 });
        for (let i=0; i<3 && this.alive(actor) && this.present(target); i++) {
          strike({ damage: actor.attack * (i === 2 && !target.shield ? .75 : .45), shieldMultiplier: i === 2 ? 2 : 1 });
        }
        return true;
      }
      case 'tetsuo': {
        const boosted = (this.active(actor.side)?.resistedUntil ?? 0) > this.time;
        return strike({ damage: actor.magic * (boosted ? 1.65 : 1.1), magic: true, removeShield: boosted });
      }
      case 'kaguya': {
        if (actor.uses >= 2 || actor.skillReady > this.time) return false;
        actor.uses++;
        actor.skillReady = this.time + 12000;
        this.teams[target.side].filter(u=>this.alive(u)).forEach(u=>{applyNegative(u,'weakenUntil',this.time + 4000);});
        this.teams[actor.side].filter(u=>this.alive(u)).forEach(u=>{u.powerUntil = this.time + 4000;});
        this.record('dimensão', actor, target);
        return true;
      }
      case 'saitama': {
        if (actor.uses >= 2 || actor.skillReady > this.time || target.actions - (actor.seenId === target.id ? actor.seenActions : 0) < 3) return false;
        actor.uses++;
        actor.skillReady = this.time + 10000;
        actor.seenId = target.id;
        actor.seenActions = target.actions;
        return strike({ damage: actor.attack * 2.8, removeShield: true, ignoreDefense: .5 });
      }
      default: return false;
    }
  }

  run() {
    for (this.time = SAMPLE_STEP; this.time <= this.limit; this.time += SAMPLE_STEP) {
      if (!this.active(0) || !this.active(1)) break;
      const order = [0, 1].sort((a,b) => (this.time / SAMPLE_STEP) % 2 ? a-b : b-a);
      for (const side of order) {
        const own = this.active(side);
        if (!own) continue;
        for (const actor of this.mode === 'duelo' ? [own] : this.teams[side]) {
          const target = this.mode === 'equipe' ? this.teams[1-side].filter(u=>this.present(u)).sort((a,b)=>(b.x??-b.slot)-(a.x??-a.slot))[0] : this.active(1-side);
          if (!target || !this.present(actor) || actor.nextBasic > this.time || actor.graceUntil > this.time) continue;
          if(this.blocked(actor))continue;
          this.beginAttack(actor);
          actor.nextBasic = this.time + actor.interval*this.pace(actor);
          actor.actions++;
          if (!this.use(actor, target, actor.kind) || MAIN_SKILLS.has(actor.kind) && ['piccolo','ward','bulma','heal'].includes(actor.kind)) this.hit(actor, target, { skill: false, damage: actor.magicBasic ? actor.magic : actor.attack, magic: !!actor.magicBasic });
        }
        if (this.mode === 'duelo') for (const reserve of this.teams[side]) {
          const ally = this.active(side);
          const target = this.active(1-side);
          if (!ally || !target || !this.alive(reserve) || reserve === ally || this.blocked(reserve) || reserve.nextAssist > this.time) continue;
          reserve.nextAssist = this.time + 7000;
          if (reserve.healer) this.heal(ally, reserve.healer);
          else if (reserve.assist) this.use(reserve, target, reserve.assist, 'reserva');
        }
      }
      if (!this.active(0) || !this.active(1)) break;
    }
    const live = this.teams.map(t=>t.some(u=>this.alive(u)));
    const scores = this.teams.map(t=>sum(t.map(u=>u.hp/u.maxHp))/t.length);
    const timeout = live.every(Boolean);
    const scoreDiff = scores[0]-scores[1];
    const winner = timeout ? (Math.abs(scoreDiff)<HP_EPSILON ? null : scoreDiff>0?0:1) : live[0]===live[1]?null:live[0]?0:1;
    return { winner, seconds: Math.min(this.time,this.limit)/1000, reason: timeout?'limite':'eliminação', scores, events: this.log };
  }
}



// Fixed-step simulation in a 100 × 50 arena.
const DT=1/60;
function collisionBonus(hits){return Math.min(40,12*hits);}

function rawCollision(f){
  return (f.magicBasic?f.magic:f.attack)*(1+collisionBonus(f.hits)/100);
}
function collisionPower(m,f){
  return m.combat.outgoingPower(f,rawCollision(f),true);
}
const arenaKinds={
  "sukuna-forma-original": "santuario",
  "saitama": "saitama",
  "kaguya-otsutsuki": "kaguya",
  "barba-branca-auge": "tremor",
  "gol-d-roger": "rei",
  "simon-tengen-toppa": "simon",
  "meruem-pos-rosa": "meruem_rei",
  "eternal-sailor-moon": "sailor",
  "lucius-zogratis": "lucius",
  "ultimate-madoka": "madoka",
  "yhwach": "yhwach",
  "giorno-gold-experience-requiem": "giorno",
  "meliodas-magia-verdadeira": "meliodas_v"
};
function arenaUnit(f){return {...f,characterId:f.id,kind:arenaKinds[f.id]??f.kind};}
function createDuel(left,right,limit=120){
  const combat=new Combate([left.map(arenaUnit),right.map(arenaUnit)]);
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
function finishDuel(match){
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
  const swordCombo={triggered:false};
  let shot, ceroIndex=0;
  const launch=(target,attack)=>{
    if(attack.bladeIndex!==undefined){
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x)+(attack.bladeIndex?1:-1)*.055;
      m.shots.push({kind:'blade',f,side:f.side,x:origin.x,y:origin.y,angle,born:m.t,attacks:[attack],radius:2,range:110,speed:88,combo:swordCombo});
      return true;
    }
    if(attack.skill!==false && ['santuario','dominio'].includes(f.kind)){
      if(!shot){
        shot={kind:f.kind,f,side:f.side,born:m.t,x:origin.x,y:origin.y,radius:f.kind==='dominio'?25.5:22,attack,pulse:0};
        m.shots.push(shot);
      }
      return true;
    }
    if(f.kind==='reescrita'&&attack.skill!==false){
      origin.ignition={born:m.t,attack};return true;
    }
    if(attack.skill!==false && f.kind==='beerus'){
      fireBatch(m,f,'beerus_hakai',attack,110,65);
      return true;
    }
    if(f.kind==='tremor'&&attack.area){
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x);
      const q={kind:'tremor',f,side:f.side,x:origin.x+R*Math.cos(angle),y:origin.y+R*Math.sin(angle),born:m.t,angle,attack,struck:new Set(),support:role==='reserva'};
      m.shots.push(q);

      return true;
    }
    if(f.kind==='saitama' && attack.skill!==false){
      fireBatch(m,f,'saitama_soco',attack,30,108);return true;
    }
    if(f.kind==='rei' && attack.pierceFirst){
      origin.dash={angle:Math.atan2(other.y-origin.y,other.x-origin.x),born:m.t,attack};
      return true;
    }
    if(f.kind==='metralleta' && attack.skill!==false){
      const spread=[-3,0,3][ceroIndex++]*Math.PI/180;
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x)+spread;
      m.shots.push({kind:'cero',f,side:f.side,x:origin.x+R*Math.cos(angle),
        y:origin.y+R*Math.sin(angle),angle,born:m.t,attacks:[attack],radius:.32,range:120,speed:78});
      return true;
    }
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
  const logStart=m.combat.log.length;
  const fromThird=['simon','meruem_rei','sailor','lucius'].includes(f.kind);
  const fourth=['madoka','yhwach','giorno','meliodas_v'].includes(f.kind);
  const used=fourth?castFourth(m,f,enemy,role):fromThird?castThird(m,f,enemy,role):m.combat.use(f,enemy,f.kind,role,launch);
  if((fromThird||fourth) && used)m.combat.record('especial',f,enemy,{name:f.skill,role});
  if(used && f.kind==='kaguya')m.flashes.push({art:'kaguya_fenda',x:origin.x,y:origin.y,time:m.t});
  if(used && f.kind==='reescrita' && m.combat.log.slice(logStart).some(e=>e.type==='cura')){
    const event=m.combat.log.slice(logStart).find(e=>e.type==='cura');
    const side=Number(event.actor.split(':')[0]);
    m.flashes.push({art:'shinra_cura',follow:side,time:m.t});
  }
  if(used && role==='principal')f.actions++;
  if(!used&&role==='principal'&&!fromThird&&!fourth&&m.combat.pace(f)<1){
    // Accelerated basic attacks also need a spatial hit.
    launch(enemy,{skill:false,magic:f.magicBasic,damage:f.magicBasic?f.magic:f.attack});
    if(!shot)return;
    shot.kind=f.magicBasic?'bolt':'blade';shot.radius=f.magicBasic?2:3;
    shot.speed=f.magicBasic?78:90;shot.range=f.magicBasic?110:25;shot.basic=true;
  }
}
function negativeKeys(unit,time){
  return [...(unit.dots?.keys()??[]),...['weakenUntil','stunUntil','exposedUntil'].filter(k=>unit[k]>time),...(unit.crackedShield?['crackedShield']:[])];
}
function interceptNegative(unit,key){
  if(!unit.cleanSeal?.has(key))return false;
  unit.cleanSeal=null;return true;
}
function applyNegative(unit,key,value){
  if(!interceptNegative(unit,key))unit[key]=value;
}
function cleanse(unit,time,seal){
  const keys=negativeKeys(unit,time);
  for(const k of keys){if(unit.dots?.has(k))unit.dots.delete(k);else unit[k]=0}
  if(seal&&keys.length)unit.cleanSeal=new Set(keys);
  return keys.length;
}
function grantShield(unit,amount){
  if(unit.crackedShield){amount*=.5;unit.crackedShield=false}
  unit.shield=Math.max(unit.shield,amount);
}
function spendLostAction(m,f){
  if(!f.loseAction)return false;
  f.loseAction=false;note(m,f.name+' · ação anulada');return true;
}
function castFourth(m,f,enemy,role){
  const c=m.combat,bench=role==='reserva',active=c.active(f.side),t=c.time;
  if(!active||(!bench&&f.skillReady>t))return false;
  const flash=(art)=>m.flashes.push({art,follow:f.side,time:m.t});
  if(f.kind==='madoka'){
    if(bench){if(!cleanse(active,t,true))return false}
    else for(const ally of c.teams[f.side])if(c.alive(ally))cleanse(ally,t,false);
    flash('madoka_purifica');
  }else if(f.kind==='yhwach'){
    if(bench){if(f.benchFutureSpent)return false;f.benchFutureSpent=true;active.futureUntil=t+4000}
    else if(f.almightySpent)return false;
    flash('yhwach_visao');
  }else if(f.kind==='giorno'){
    if(c.zeroUsed?.[f.side]||active.zeroGuard)return false;
    if(bench)active.zeroGuard=true;
    flash('giorno_selo');
  }else{
    const energy=bench?(active.recentImpact??[]).filter(e=>t-e.t<=4000).reduce((n,e)=>n+e.n,0):(f.demonCharge??0);
    if(!energy)return false;
    fireBatch(m,f,'meliodas_corte',{damage:energy,crack:!bench},60,97);
    if(!bench)f.demonCharge=0;
    flash('meliodas_reserva');
  }
  if(!bench)f.skillReady=t+8000;
  return true;
}
function castThird(m,f,enemy,role){
  const combat=m.combat,t=combat.time,side=m.sides[f.side],ally=side.team[side.slot],bench=role==='reserva';
  if(!bench && f.skillReady>t)return false;
  const flash=(art,follow=f.side)=>m.flashes.push({art,follow,time:m.t});
  if(f.kind==='simon'){
    const events=combat.log.filter(e=>bench?e.type==='entra'&&e.actor.startsWith(f.side+':'):e.type==='cai'&&e.actor.startsWith(f.side+':')&&e.actor!==f.id);
    const stacks=bench?events.length:new Set(events.map(e=>e.actor)).size;
    const factor=1+.25*stacks;
    fireBatch(m,f,'simon_broca',{damage:f.attack*1.5*factor},110,90);
    const drill=m.shots.at(-1);drill.size=21+Math.min(stacks,8)*2;drill.radius=drill.size*.12;
    flash('simon_espiral');
  }else if(f.kind==='meruem_rei'){
    if(bench){
      if(!enemy.lastDamageType)return false;
      ally.adaptiveType=enemy.lastDamageType;ally.adaptiveUntil=t+4000;flash('meruem_carapaca');
    }else{
      const magic=enemy.resistance<enemy.defense;
      fireBatch(m,f,magic?'meruem_esfera':'meruem_lamina',{damage:f.attack*1.5,magic},65,92);
    }
  }else if(f.kind==='sailor'){
    const team=bench?[ally]:side.team.filter(u=>combat.alive(u));
    let excess=0;
    for(const u of team){
      const heal=f.magic*(bench?.8:1.25);excess+=Math.max(0,heal-(u.maxHp-u.hp));combat.heal(u,heal);
    }
    if(bench)ally.moonGuard=true;
    else for(const u of team)u.moonShield=(u.moonShield??0)+excess/team.length;
    if(!bench)m.flashes.push({art:'sailor_onda',x:side.x,y:side.y,time:m.t});
    flash('sailor_cura');
  }else{
    if((!bench&&f.timeSpent)||ally.timeMark?.until>t)return false;
    ally.timeMark={hp:ally.hp,until:bench?t+5000:Infinity,main:!bench,owner:f};
  }
  if(!bench)f.skillReady=t+8000;
  return true;
}
function fireBatch(m,f,art,attack,range,speed){
  const from=m.sides[f.side],to=m.sides[1-f.side],angle=Math.atan2(to.y-from.y,to.x-from.x);
  m.shots.push({kind:'batch',art,angle,side:f.side,f,born:m.t,speed,range,radius:projectileRadius[art]??(art==='saitama_soco'?3.2:1),
    x:from.x+R*Math.cos(angle),y:from.y+R*Math.sin(angle),attacks:[attack]});
}
const mageShots={dominio:'gojo_basico',santuario:'sukuna_basico',beerus:'beerus_basico',kaguya:'kaguya_basico'};
const projectileRadius={meliodas_corte:3,meruem_esfera:2.4,meruem_lamina:2,beerus_hakai:5.2,beerus_basico:1.1,kaguya_basico:1.0,shinra_golpe:2.3};
function quakeRadius(age){return [3,8,14,18][Math.min(3,Math.floor(Math.max(0,age)/.06))]}
function quakeContact(m,q,victim,position){
  if(q.struck.has(victim.id))return;
  q.struck.add(victim.id);
  if(m.combat.hit(q.f,victim,q.attack))m.flashes.push({art:'barba_fratura',x:position.x,y:position.y,time:m.t});
}
function traceHit(x,y,dx,dy,radius){
  const len=dx*dx+dy*dy;
  const u=len?Math.max(0,Math.min(1,-(x*dx+y*dy)/len)):0;
  return Math.hypot(x+u*dx,y+u*dy)<=radius;
}
const ceroMaxLength=26;
const ceroProfile=[1,3,5,7,11,13,15,16,16,15,13,11,9,7,4,1];
function ceroLength(age,speed){return Math.min(ceroMaxLength,Math.max(.6,age*speed));}
function resolveShots(m,previous){
  m.flashes=m.flashes.filter(e=>m.t-e.time<(e.art==='shinra_fratura'?.28:e.art==='saitama_onda'?.32:e.art?.16:(e.kind==='cero'||e.kind==='rei')?.16:.23));
  const followUps=[];
  m.shots=m.shots.filter(s=>{
    const caster=m.sides[s.side],other=m.sides[1-s.side],victim=other.team[other.slot];
    if(!m.combat.alive(s.f)||!victim||!m.combat.present(victim))return false;
    if(s.kind==='muda'){
      const ux=Math.cos(s.angle),uy=Math.sin(s.angle),remaining=s.range-(s.traveled??0);
      const distance=Math.min(remaining,s.speed*DT);
      const [ox,oy]=previous[1-s.side],rx=s.x-ox,ry=s.y-oy;
      const dx=ux*distance-(other.x-ox),dy=uy*distance-(other.y-oy);
      const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-(R+s.radius)**2;
      const disc=b*b-a*c,t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/a:Infinity;
      if(t>=0&&t<=1){
        const nx=rx+t*dx,ny=ry+t*dy,len=Math.hypot(nx,ny)||1;
        const before=m.combat.log.length;
        m.combat.hit(s.f,victim,{skill:true,magic:false,damage:s.f.attack*MUDA_HIT_RATIO});
        const landed=m.combat.log.slice(before).some(e=>e.type==='dano'&&e.actor===s.f.id&&e.target===victim.id);
        if(landed)m.flashes.push({art:'giorno_impacto',x:ox+(other.x-ox)*t+R*nx/len,y:oy+(other.y-oy)*t+R*ny/len,time:m.t});
        return false;
      }
      s.x+=ux*distance;s.y+=uy*distance;s.traveled=(s.traveled??0)+distance;
      return s.traveled<s.range&&s.x>=0&&s.x<=100&&s.y>=0&&s.y<=50;
    }
    const age=m.t-s.born,zone=s.kind==='room'||s.kind==='zone';
    if(s.kind==='tremor'){
      if(age<.24){
        if(!s.support&&Math.hypot(other.x-s.x,other.y-s.y)<=quakeRadius(age)+R)quakeContact(m,s,victim,other);
        return true;
      }
      const ux=Math.cos(s.angle),uy=Math.sin(s.angle);
      const start=s.support?0:18;
      const front=start+84*(age-.24),oldFront=Math.max(start,front-84*DT);
      const [ox,oy]=previous[1-s.side];
      const oldAlong=(ox-s.x)*ux+(oy-s.y)*uy-oldFront;
      const along=(other.x-s.x)*ux+(other.y-s.y)*uy-front;
      const lateral=Math.abs(-(other.x-s.x)*uy+(other.y-s.y)*ux);
      if(Math.min(oldAlong,along)<=R+1 && Math.max(oldAlong,along)>=-R-1 && lateral<=R+10)
        quakeContact(m,s,victim,other);
      const cx=s.x+ux*front,cy=s.y+uy*front;
      return cx>=-12&&cx<=112&&cy>=-12&&cy<=62;
    }
    if(s.kind==='dominio'||s.kind==='santuario'){
      const gojo=s.kind==='dominio',charge=gojo?.36:0;
      if(gojo && age<charge){s.x=caster.x;s.y=caster.y;return true}
      if(gojo&&!s.open){s.x=caster.x;s.y=caster.y;s.open=true}
      const end=charge+(gojo?1.5:1.6);
      if(age>=end)return false;
      const inside=Math.hypot(other.x-s.x,other.y-s.y)<=R+s.radius;
      if(gojo){
        if(inside){applyNegative(victim,'stunUntil',Math.max(victim.stunUntil??0,m.combat.time+18));
          if(!s.applied){m.combat.hit(s.f,victim,s.attack);s.applied=true}}
      }else if(age>=s.pulse*.4){
        s.pulse++;
        if(inside){m.combat.hit(s.f,victim,s.attack);m.flashes.push({art:'sukuna_corte',x:other.x,y:other.y,time:m.t})}
      }
      return true;
    }
    let hit=false;
    if(zone){
      // Activate after the ring has opened. ROOM remains armed for one cut.
      if(age<.3)return true;
      hit=Math.hypot(other.x-s.x,other.y-s.y)<=s.radius+R;
      if(!hit && age<(s.kind==='room'?1.5:.45))return true;
    }else{
      const [ox,oy]=previous[1-s.side],vx=Math.cos(s.angle)*s.speed*DT,vy=Math.sin(s.angle)*s.speed*DT;
      if(s.kind==='cero'){
        const before=ceroLength(age-DT,s.speed),after=ceroLength(age,s.speed);
        const ux=Math.cos(s.angle),uy=Math.sin(s.angle);
        let first=Infinity;
        for(let i=0;i<ceroProfile.length;i++){
          const offset=i*5/80,radius=after*ceroProfile[i]/160;
          const rx=s.x-before*offset*ux-ox,ry=s.y-before*offset*uy-oy;
          const dx=vx-(after-before)*offset*ux-(other.x-ox);
          const dy=vy-(after-before)*offset*uy-(other.y-oy);
          const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-(radius+R)**2;
          const disc=b*b-a*c;
          const t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/a:Infinity;
          if(t<0||t>1||t>=first)continue;
          const x=s.x+t*vx,y=s.y+t*vy;
          if(x<0||x>100||y<0||y>50)continue;
          first=t;hit=true;
          const nx=rx+t*dx,ny=ry+t*dy,len=Math.hypot(nx,ny)||1;
          s.contactX=ox+t*(other.x-ox)+R*nx/len;
          s.contactY=oy+t*(other.y-oy)+R*ny/len;
        }
      }else hit=traceHit(s.x-ox,s.y-oy,vx-(other.x-ox),vy-(other.y-oy),s.radius+R);
      s.x+=vx;s.y+=vy;
      if(!hit&&age*s.speed<s.range&&s.x>=0&&s.x<=100&&s.y>=0&&s.y<=50)return true;
    }
    if(s.art==='saitama_soco'){
      const direction=Math.atan2(s.y-other.y,s.x-other.x);
      const x=hit?other.x+R*Math.cos(direction):s.x;
      const y=hit?other.y+R*Math.sin(direction):s.y;
      m.flashes.push({art:'saitama_onda',x,y,angle:s.angle,time:m.t+.045});
    }
    if(!hit){note(m,(s.basic?'Ataque básico':s.f.skill)+' · errou');return false;}
    if(s.kind==='batch'){
      const last=m.combat.log.length;
      const resolved=m.combat.hit(s.f,victim,s.attacks[0]);
      if(resolved && m.combat.log.slice(last).some(e=>e.type==='dano'&&e.actor===s.f.id&&e.target===victim.id)){
        const a=Math.atan2(s.y-other.y,s.x-other.x);
        m.flashes.push({art:({meliodas_corte:'meliodas_contato',simon_broca:'simon_impacto',meruem_esfera:'meruem_impacto',meruem_lamina:'meruem_impacto',beerus_hakai:'beerus_dissipacao',beerus_basico:'beerus_dissipacao',kaguya_basico:'kaguya_fragmentos',shinra_golpe:'contato_dourado'})[s.art]??(s.art==='saitama_soco'?'saitama_impacto':s.art==='sukuna_basico'?'sukuna_corte':'contato_azul'),x:other.x+R*Math.cos(a),y:other.y+R*Math.sin(a),time:m.t});
      }
      return false;
    }
    m.flashes.push({kind:s.kind,side:s.side,x:s.contactX??other.x,y:s.contactY??other.y,fromX:caster.x,fromY:caster.y,time:m.t});
    for(const attack of s.attacks){
      if(!m.combat.alive(s.f)||!m.combat.present(victim))break;
      if(!s.basic&&s.f.kind==='ashisogi')applyNegative(victim,'weakenUntil',Math.max(victim.weakenUntil,m.combat.time+4000));
      const logStart=m.combat.log.length;
      m.combat.hit(s.f,victim,attack);
      if(s.combo&&!s.combo.triggered&&m.combat.log.slice(logStart).some(e=>e.type==='dano'&&e.actor===s.f.id&&e.target===victim.id)){
        s.combo.triggered=true;
        followUps.push({kind:'blade',f:s.f,side:s.side,x:caster.x,y:caster.y,angle:Math.atan2(other.y-caster.y,other.x-caster.x),born:m.t,attacks:[{damage:s.f.attack,ignoreDefense:.5}],radius:2.5,range:110,speed:96});
      }
      if(!s.basic&&s.f.kind==='dominio')applyNegative(victim,'stunUntil',Math.max(victim.stunUntil??0,m.combat.time+1500));
    }
    return false;
  });
  m.shots.push(...followUps);
}
const passiveEvents={'aceleração':'Made in Heaven · Aceleração do Tempo','tempo parado':'The World','ressurge':'Ressurgimento'};
const dotKinds={'portgas-d-ace':'dot_fogo','meliodas-magia-verdadeira':'dot_chamas_negras','shinra_banshoman':'dot_chamas_azuis','sukuna-forma-original':'dot_sangramento'};
function applyDot(m,source,target,key,damage,period,count){
  if(interceptNegative(target,key))return;
  const states=target.dots??=new Map();
  states.set(key,{key,source,damage,period,count,start:m.t,next:m.t+period,lastTick:null});
}
function stepDots(m,target){
  for(const [key,state] of target.dots??[]){
    if(!m.combat.present(target)||!m.combat.alive(state.source)){target.dots.delete(key);continue}
    if(m.t+1e-8<state.next)continue;
    m.combat.hit(state.source,target,{area:true,skill:false,magic:key!=='dot_sangramento',damage:state.damage});
    state.lastTick=m.t;state.next+=state.period;
    if(--state.count===0||!m.combat.present(target))target.dots.delete(key);
  }
}
const MUDA_HIT_RATIO=0.20;
function updateBarrage(m,f){
  if(f.kind!=='giorno')return;
  const side=m.sides[f.side],other=m.sides[1-f.side];
  const d=Math.hypot(other.x-side.x,other.y-side.y);
  if(d>22)f.barrageInside=false;
  if(!m.combat.present(f)||m.combat.blocked(f)||!m.combat.present(other.team[other.slot])){
    f.punchesLeft=0;return;
  }
  if(!f.barrageInside&&d<=18&&!f.punchesLeft){
    f.barrageInside=true;f.punchesLeft=6;f.nextPunch=m.t;
    note(m,'Gold Experience Requiem · Muda Barrage');
  }
  if(!f.punchesLeft||m.t+1e-8<f.nextPunch)return;
  const index=6-f.punchesLeft,angle=Math.atan2(other.y-side.y,other.x-side.x);
  const ux=Math.cos(angle),uy=Math.sin(angle),offset=[-2.4,1.8,-1,2.6,-2,0][index];
  m.shots.push({kind:'muda',f,side:f.side,angle,born:m.t,x:side.x+3.3*ux-offset*uy,
    y:side.y+3.3*uy+offset*ux,speed:97,range:17,radius:1.1});
  f.punchesLeft--;f.nextPunch+=.075;
}
function stepDuel(m){
  if(m.result!==null)return;
  m.t+=DT;
  const combat=m.combat;
  const firstEvent=combat.log.length;
  combat.time=Math.round(m.t*1000);
  const [a,b]=m.sides, active=m.sides.map(s=>s.team[s.slot]);
  const previous=m.sides.map(s=>[s.x,s.y]);
  m.sides.forEach((s,i)=>{
    if(!s.ignition)return;
    if(!combat.present(active[i])||combat.blocked(active[i])){delete s.ignition;return}
    if(m.t-s.ignition.born<.20)return;
    const target=m.sides[1-i];
    s.dash={art:'shinra_golpe',born:m.t,angle:Math.atan2(target.y-s.y,target.x-s.x),attack:s.ignition.attack};
    delete s.ignition;
  });
  const charging=m.sides.map(s=>s.dash);
  m.sides.forEach((s,i)=>{
    if(!combat.present(active[i])||combat.blocked(active[i])){delete s.dash;return}
    if(!s.dash){move(s,active[i]);return}
    const ux=Math.cos(s.dash.angle),uy=Math.sin(s.dash.angle);
    const wallX=ux>0?(100-R-s.x)/ux:ux<0?(R-s.x)/ux:Infinity;
    const wallY=uy>0?(50-R-s.y)/uy:uy<0?(R-s.y)/uy:Infinity;
    const dist=Math.min(110*DT,wallX,wallY);
    s.x+=dist*ux;s.y+=dist*uy;
    if(dist<110*DT||m.t-s.dash.born>=.4)delete s.dash;
  });
  charging.forEach((dash,i)=>{
    if(!dash||!combat.present(active[i])||combat.blocked(active[i]))return;
    const enemy=active[1-i],s=m.sides[i],o=m.sides[1-i];
    const [x,y]=previous[i],[ox,oy]=previous[1-i];
    const rx=x-ox,ry=y-oy,dx=s.x-x-(o.x-ox),dy=s.y-y-(o.y-oy);
    const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-4*R*R;
    const d=b*b-a*c,t=c<=0?0:a&&d>=0?(-b-Math.sqrt(d))/a:Infinity;
    if(t<0||t>1||!combat.present(enemy))return;
    s.x=x+t*(s.x-x);s.y=y+t*(s.y-y);
    delete s.dash;
    const flash={kind:'rei',x:(s.x+ox+t*(o.x-ox))/2,y:(s.y+oy+t*(o.y-oy))/2,time:m.t,angle:dash.angle};
    const start=combat.log.length;
    combat.hit(active[i],enemy,dash.attack);
    if(!dash.art)m.flashes.push(flash);
    else if(combat.log.slice(start).some(e=>e.type==='dano'&&e.target===enemy.id))
      m.flashes.push({...flash,art:'shinra_fratura',kind:'fratura'});
    m.contact=Math.max(m.contact,m.t+.45);
  });
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
      if(mageShots[f.kind])continue;
      if(spendLostAction(m,f))continue;
      f.actions++;
      if(combat.hit(f,g,{damage:rawCollision(f),skill:false,magic:!!f.magicBasic}))f.hits++;
    }
    note(m,'Colisão · '+active.map(f=>f.name).join(' × '));m.contact=m.t+.45;
  }
  for(const f of active){
    if(!combat.present(f)||combat.blocked(f)||!mageShots[f.kind]||f.nextBasic>combat.time)continue;
    f.nextBasic=combat.time+f.interval;if(spendLostAction(m,f))continue;f.actions++;
    fireBatch(m,f,mageShots[f.kind],{magic:true,skill:false,damage:f.magic},110,78);
  }
  for(const unit of active)stepDots(m,unit);
  resolveShots(m,previous);
  for(const f of active)updateBarrage(m,f);
  m.sides.forEach((side,i)=>{
    const ally=active[i],enemy=active[1-i];
    for(const f of side.team.slice(side.slot)){
      if(f.ready>m.t||!combat.present(ally)||!combat.present(enemy)||combat.blocked(f))continue;
      const reserve=f!==ally;
      if(!reserve)combat.beginAttack(f);
      f.ready=m.t+(reserve?8:2)*combat.pace(f);
      if(spendLostAction(m,f))continue;
      if(reserve && f.role==='Suporte' && !f.signatureAssist){
        combat.heal(ally,Math.round(f.magic*.8));announce(m,f,'Cura de apoio','reserva');
      }else{
        arenaCast(m,f,enemy,reserve?'reserva':'principal');
        if(['koto','demonSword','fiction'].includes(f.kind)&&f.skillReady>combat.time)
          f.ready=m.t+(f.skillReady-combat.time)/1000;

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
    if(['carapaca','lunar','reverte'].includes(e.type)){
      const side=Number(e.actor.split(':')[0]);m.flashes.push({art:{carapaca:'meruem_carapaca',lunar:'sailor_barreira',reverte:'lucius_reversao'}[e.type],follow:side,time:m.t});
    }
    if(['zero','futuro','ciclos'].includes(e.type)){
      const side=Number(e.actor.split(':')[0]);m.flashes.push({art:{zero:'giorno_zero',futuro:'yhwach_futuro',ciclos:'madoka_retorno'}[e.type],follow:side,time:m.t});
      if(e.type==='zero'&&e.main)m.flashes.push({art:'giorno_acao',follow:1-side,time:m.t});
    }
    if(e.type==='portal'){
      const side=Number(e.actor.split(':')[0]);
      m.flashes.push({art:'kaguya_fenda',follow:side,time:m.t});
    }
    if(e.type==='instintiva'||e.type==='ilimitado'){
      const [side,slot]=e.actor.split(':').map(Number),s=m.sides[side],f=s.team[slot];
      if(e.type==='instintiva')fireBatch(m,f,'goku_contra',{damage:f.attack,skill:false,counter:true},110,125);
      else m.flashes.push({art:'gojo_ilimitado',follow:side,x:s.x,y:s.y,time:m.t});
      note(m,f.name+(e.type==='instintiva'?' · esquiva e contra-ataca':' · Ilimitado'));
    }
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
export {collisionBonus,collisionPower,createDuel,finishDuel,stepDuel};
