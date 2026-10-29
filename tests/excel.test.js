import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {workbook} from '../server/excel.js';
test('Excel OOXML mantém números e escapa textos sem fórmulas',()=>{
 const files=unzipSync(workbook([{name:'Serviços',rows:[{Nome:'=1+1 & <teste>',Quantidade:350}]}]));
 assert.ok(files['[Content_Types].xml']);
 assert.ok(files['xl/_rels/workbook.xml.rels']);
 const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/t="inlineStr"/);
 assert.match(sheet,/&amp; &lt;teste&gt;/);
 assert.match(sheet,/<v>350<\/v>/);
 assert.ok(!sheet.includes('<f>'));
});
