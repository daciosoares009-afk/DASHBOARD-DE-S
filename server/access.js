import { all } from './store.js';

export function recordsFor(user, includeArchived = false) {
    const records = all('SELECT * FROM records WHERE org=?', user.org)
        .map(row => ({ ...JSON.parse(row.data), id: row.id, kind: row.kind, parent: row.parent, archived: !!row.archived }));
    if (user.role === 'admin') return records.filter(row => includeArchived || !row.archived);

    const byId = new Map(records.map(row => [row.id, row]));
    const allowed = new Set();
    if (user.role === 'manager') {
        const grants = all('SELECT work FROM work_access WHERE user=?', user.id);
        const workIds = new Set(grants.map(grant => grant.work));
        for (const row of records) {
            let ancestor = row;
            while (ancestor.parent && byId.has(ancestor.parent)) ancestor = byId.get(ancestor.parent);
            if (workIds.has(ancestor.id) || row.kind === 'team') allowed.add(row.id);
        }
    } else if (user.role === 'collaborator') {
        for (const row of records) {
            if (!['task', 'stage'].includes(row.kind) || row.owner !== user.id || row.archived) continue;
            for (let ancestor = row; ancestor && !ancestor.archived; ancestor = byId.get(ancestor.parent)) {
                allowed.add(ancestor.id);
            }
        }
    }
    return records.filter(row => allowed.has(row.id) && (includeArchived || !row.archived));
}
