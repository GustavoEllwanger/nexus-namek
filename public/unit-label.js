import {CHARACTERS} from './game.js';
export function unitLabel(unit){
  const c=CHARACTERS[unit.id];
  if(!c)return 'Personagem';
  return `<span class="rar-name rarity-${c.tier}">${c.name}</span>`+(unit.shiny?'<span class="shiny-seal"><i aria-hidden="true"></i>Shiny</span>':'');
}
