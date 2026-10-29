export function progress(task) { return task.mode === 'quantity' ? Math.min(100, task.planned > 0 ? task.executed / task.planned * 100 : 0) : task.percent; }
export function aggregate(tasks) {
    if (!tasks.length)
        return null;
    const comparable = tasks.every(t => t.mode === 'quantity' && t.planned > 0 && t.unit === tasks[0].unit);
    if (!comparable && !tasks.every(t => t.weight > 0))
        return null;
    const weight = t => comparable ? t.planned : t.weight;
    return tasks.reduce((sum, t) => sum + progress(t) * weight(t), 0) / tasks.reduce((sum, t) => sum + weight(t), 0);
}
export function status(task, today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })) {
    if (progress(task) >= 100)
        return 'Concluído';
    if (task.end && task.end < today)
        return 'Atrasado';
    return progress(task) > 0 ? 'Em andamento' : 'Pendente';
}
export function floorCopy(task, floor) {
    const replace = value => value.replace(/\d+º?\s*(pavimento|pav\.?)/ig, `${String(floor).padStart(2, '0')}º pavimento`);
    return { ...task, name: replace(task.name), location: replace(task.location), executed: 0, percent: 0 };
}
