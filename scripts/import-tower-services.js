// Importação idempotente da estrutura fornecida pelo usuário.
import {randomUUID} from 'node:crypto';
import {all,one,run,transaction} from '../server/store.js';
const organizations=all('SELECT id,name FROM organizations');
if(organizations.length!==1)throw new Error('Selecione uma organização explicitamente antes de importar.');
const org=organizations[0].id;
const floors=['01º ao 18º pavimento'];
const allFloors=['Térreo ao 18º pavimento'];
const withRoof=['Térreo até 18º pavimento + Barrilete'];
const definitions=[
 ['Impermeabilização',[['',withRoof]]],
 ['INSTALAÇÃO FOLHAS PCF',[['Lado A',withRoof],['Lado B',withRoof]]],
 ['REJUNTE',[['Terraço aptos',floors],['Hall',allFloors]]],
 ['1ª DEMÃO PINTURA INTERNA',[['',allFloors]]],
 ['2ª DEMÃO PINTURA INTERNA',[['',allFloors]]],
 ['REVESTIMENTO CERÂMICO',[['Terraço aptos',floors],['Hall',allFloors]]],
 ['PORTAS MADEIRA INTERNA',[['Aptos',floors]]],
 ['GUARNIÇÕES INTERNAS',[['Aptos',floors]]]
];
function insert(kind,parent,data){const id=randomUUID();run('INSERT INTO records(id,org,kind,parent,data) VALUES(?,?,?,?,?)',id,org,kind,parent,JSON.stringify(data));return id;}
const result=transaction(()=>{
 const existing=all("SELECT id,data FROM records WHERE org=? AND kind='work' AND archived=0",org);
 if(existing.length>1)throw new Error('Há várias obras; selecione a obra antes de importar.');
 const work=existing[0]?.id||insert('work',null,{name:'Torre',code:'TORRE-01',address:'',description:'',owner:'',start:'',end:'',status:'Planejada'});
 let createdGroups=0,createdTasks=0,archivedTasks=0;
 for(const [name,locations] of definitions){
  let group=all("SELECT id,data FROM records WHERE org=? AND kind='group' AND parent=? AND archived=0",org,work).find(g=>JSON.parse(g.data).name===name)?.id;
  if(!group){group=insert('group',work,{name,end:''});createdGroups++;}
  // Corrige somente as atividades individuais da importação anterior,
  // preservando fisicamente os registros. Não altera medições do usuário.
  const old=all("SELECT id,data FROM records WHERE org=? AND kind='task' AND parent=? AND archived=0",org,group);
  for(const row of old){
   const t=JSON.parse(row.data);
   if(!/^(?:\d{2}º pavimento|Térreo|Barrilete)(?: — (?:Lado A|Lado B|Terraço aptos|Hall|Aptos))?$/.test(t.name))continue;
   if(t.percent||t.executed||one('SELECT id FROM history WHERE task=?',row.id))throw new Error('Há execução registrada; revise a consolidação antes de continuar.');
   run('UPDATE records SET archived=1 WHERE id=? AND org=?',row.id,org);
   archivedTasks++;
  }
  const names=new Set(all("SELECT data FROM records WHERE org=? AND kind='task' AND parent=? AND archived=0",org,group).map(t=>JSON.parse(t.data).name));
  for(const [area,levels] of locations){for(const floor of levels){
   const childName=area?`${floor} — ${area}`:floor;
   if(names.has(childName))continue;
   insert('task',group,{name:childName,location:childName,owner:'',start:'',end:'',mode:'manual',planned:0,executed:0,unit:'',percent:0,weight:0});
   names.add(childName);createdTasks++;
  }}
 }
 const groups=all("SELECT id FROM records WHERE org=? AND parent=? AND kind='group' AND archived=0",org,work);
 const counts=groups.map(g=>({name:JSON.parse(one('SELECT data FROM records WHERE id=?',g.id).data).name,children:one("SELECT count(*) AS n FROM records WHERE parent=? AND org=? AND kind='task' AND archived=0",g.id,org).n}));
 return {work,createdGroups,createdTasks,archivedTasks,counts};
});
console.log(JSON.stringify(result,null,2));
