import {CHARACTERS} from './game.js';
export function unitLabel(unit){
  const c=CHARACTERS[unit.id];
  if(!c)return 'Personagem';
  const stars=Math.max(0,Math.min(5,unit.stars??0));
  return `<span class="rar-name rarity-${c.tier}">${c.name}</span>`+
    (stars?`<span class="star-seal" title="${stars} estrela(s) de Despertar">${'★'.repeat(stars)}</span>`:'')+
    (unit.shiny?'<span class="shiny-seal"><i aria-hidden="true"></i>Shiny</span>':'');
}
