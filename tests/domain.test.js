import test from 'node:test';
import assert from 'node:assert/strict';
import { progress, aggregate, status, floorCopy } from '../server/domain.js';
const task = (extra = {}) => ({ name: '01º pavimento — Hall', location: '01º PAV. — Hall', mode: 'quantity', unit: 'm²', planned: 500, executed: 350, percent: 0, weight: 0, ...extra });
test('medição quantitativa e manual', () => { assert.equal(progress(task()), 70); assert.equal(progress(task({ mode: 'manual', percent: 35 })), 35); });
test('pondera quantidades comparáveis e não usa média simples', () => { assert.equal(aggregate([task({ planned: 100, executed: 100 }), task({ planned: 900, executed: 0 })]), 10); });
test('exige pesos para unidades distintas', () => { assert.equal(aggregate([task(), task({ unit: 'un.' })]), null); assert.equal(aggregate([task({ weight: 3 }), task({ mode: 'manual', percent: 30, weight: 1 })]), 60); assert.equal(aggregate([]), null); });
test('atraso e conclusão', () => { assert.equal(status(task({ end: '2026-01-01' }), '2026-10-29'), 'Atrasado'); assert.equal(status(task({ executed: 500, end: '2026-01-01' }), '2026-10-29'), 'Concluído'); });
test('duplicação atualiza pavimento e zera execução', () => { const copy = floorCopy(task(), 3); assert.equal(copy.name, '03º pavimento — Hall'); assert.equal(copy.location, '03º pavimento — Hall'); assert.equal(copy.executed, 0); assert.equal(copy.percent, 0); assert.equal(copy.planned, 500); });
